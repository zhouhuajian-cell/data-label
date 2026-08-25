"""状态机核心（PRD 2.2 矩阵为准；所有状态变更必须走这里，禁止直接改 task.status）"""
from decimal import Decimal
from typing import Any, Dict, Optional

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import VersionConflictError, MileageDifferenceError
from app.models.field_change_history import FieldChangeHistory
from app.models.operation_log import OperationLog
from app.models.task import Task
from app.models.user import User
from app.schemas.enums import OperationType, TaskStatus


class StateMachineService:
    """状态机核心业务逻辑"""

    # PRD 2.2 状态机流转矩阵（required_fields 按矩阵强制）
    TRANSITIONS: Dict[OperationType, dict] = {
        OperationType.DISPATCH: {
            "allowed_from": [TaskStatus.UNASSIGNED], "next_status": TaskStatus.ANNOTATING,
            "required_fields": [],
        },
        OperationType.COMPLETE_WORK: {
            "allowed_from": [TaskStatus.ANNOTATING], "next_status": TaskStatus.VENDOR_QA,
            "required_fields": [],
        },
        OperationType.SUBMIT_TO_TAIXING: {
            "allowed_from": [TaskStatus.VENDOR_QA], "next_status": TaskStatus.WAITING_OPTIMIZATION,
            "required_fields": ["supplier_mileage", "supplier_road_scene"],
        },
        OperationType.START_OPTIMIZATION: {
            "allowed_from": [TaskStatus.WAITING_OPTIMIZATION], "next_status": TaskStatus.OPTIMIZING,
            "required_fields": [],
        },
        OperationType.SKIP_OPTIMIZATION: {
            "allowed_from": [TaskStatus.WAITING_OPTIMIZATION], "next_status": TaskStatus.WAITING_ACCEPTANCE,
            "required_fields": ["need_optimization"],
        },
        OperationType.COMPLETE_OPTIMIZATION: {
            "allowed_from": [TaskStatus.OPTIMIZING], "next_status": TaskStatus.WAITING_ACCEPTANCE,
            "required_fields": ["need_optimization", "optimization_method"],
        },
        OperationType.ACCEPT: {
            "allowed_from": [TaskStatus.WAITING_ACCEPTANCE], "next_status": TaskStatus.ACCEPTED,
            "required_fields": ["acceptance_mileage", "acceptance_road_scene"],
        },
        OperationType.REJECT: {
            "allowed_from": [TaskStatus.WAITING_ACCEPTANCE], "next_status": TaskStatus.REJECTED,
            "required_fields": ["reject_reason"],
        },
        OperationType.RESUBMIT: {
            "allowed_from": [TaskStatus.REJECTED], "next_status": TaskStatus.ANNOTATING,
            "required_fields": ["supplier_mileage", "supplier_road_scene"],  # PRD 矩阵要求
        },
        OperationType.WAREHOUSE: {
            "allowed_from": [TaskStatus.ACCEPTED], "next_status": TaskStatus.WAREHOUSED,
            "required_fields": [],
        },
        OperationType.REQUEST_REPAIR: {
            "allowed_from": [TaskStatus.WAREHOUSED], "next_status": TaskStatus.REPAIR_REQUIRED,
            "required_fields": ["repair_reason"],
        },
        OperationType.COMPLETE_REPAIR: {
            "allowed_from": [TaskStatus.REPAIR_REQUIRED], "next_status": TaskStatus.WAITING_ACCEPTANCE,
            "required_fields": ["supplier_mileage", "supplier_road_scene"],  # PRD 矩阵要求
        },
    }

    @staticmethod
    async def transition(
        db: AsyncSession,
        task: Task,
        operation: OperationType,
        operator: User,
        payload: Dict[str, Any],
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> Task:
        """执行状态转移（核心方法）"""
        if operation not in StateMachineService.TRANSITIONS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"未知操作类型: {operation.value}")

        rule = StateMachineService.TRANSITIONS[operation]

        # 乐观锁：version 强制必填且必须匹配（防绕过乐观锁）
        expected_version = payload.get("version")
        if expected_version is None or int(expected_version) != task.version:
            raise VersionConflictError(current_version=task.version)

        # 状态合法性
        if task.status not in rule["allowed_from"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "INVALID_STATE_TRANSITION",
                        "message": f"当前状态 [{task.status.value}] 不允许执行操作 [{operation.value}]",
                        "current_status": task.status.value},
            )

        # 必填字段（version 除外）
        for field in rule["required_fields"]:
            if field not in payload or payload[field] is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"缺少必填字段: {field}")

        # 验收里程差异校验
        if operation == OperationType.ACCEPT:
            await StateMachineService._validate_mileage_difference(task, payload)

        # 字段变更历史
        field_changes = StateMachineService._build_field_changes(task, operator, payload)

        # 更新状态与字段
        previous_status = task.status
        task.status = rule["next_status"]
        if operation == OperationType.RESUBMIT:
            task.repair_round += 1
        for field, value in payload.items():
            if field in ("version", "status", "id", "created_at", "created_by"):
                continue
            if hasattr(task, field):
                setattr(task, field, value)

        task.version += 1  # 乐观锁 +1

        db.add(OperationLog(
            task_id=task.id, operator_id=operator.id, operation_type=operation,
            previous_status=previous_status.value, new_status=task.status.value,
            operation_details=payload, ip_address=ip_address, user_agent=user_agent,
        ))

        db.add(task)
        if field_changes:
            db.add_all(field_changes)
        await db.commit()
        await db.refresh(task)
        return task

    @staticmethod
    async def update_perception_usage(
        db: AsyncSession, task: Task, operator: User, payload: Dict[str, Any],
        ip_address: Optional[str] = None, user_agent: Optional[str] = None,
    ) -> Task:
        """感知更新使用状态：不改任务状态，仅更新字段 + 记日志/历史 + 乐观锁+1"""
        expected_version = payload.get("version")
        if expected_version is None or int(expected_version) != task.version:
            raise VersionConflictError(current_version=task.version)
        usage = payload.get("perception_usage_status")
        if not usage:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="缺少必填字段: perception_usage_status")

        field_changes = StateMachineService._build_field_changes(
            task, operator, {"perception_usage_status": usage}
        )
        task.perception_usage_status = usage
        task.version += 1

        db.add(OperationLog(
            task_id=task.id, operator_id=operator.id,
            operation_type=OperationType.UPDATE_PERCEPTION_USAGE,
            previous_status=task.status.value, new_status=task.status.value,
            operation_details={"perception_usage_status": usage},
            ip_address=ip_address, user_agent=user_agent,
        ))
        db.add(task)
        if field_changes:
            db.add_all(field_changes)
        await db.commit()
        await db.refresh(task)
        return task

    @staticmethod
    def _build_field_changes(task: Task, operator: User, payload: Dict[str, Any]) -> list[FieldChangeHistory]:
        changes: list[FieldChangeHistory] = []
        for field, new_value in payload.items():
            if field == "version":
                continue
            old_value = getattr(task, field, None)
            old_ser = StateMachineService._serialize(old_value)
            new_ser = StateMachineService._serialize(new_value)
            if old_ser != new_ser:
                changes.append(FieldChangeHistory(
                    task_id=task.id, operator_id=operator.id, field_name=field,
                    field_type=type(new_value).__name__,
                    old_value={"value": old_ser} if old_ser is not None else None,
                    new_value={"value": new_ser} if new_ser is not None else None,
                ))
        return changes

    @staticmethod
    def _serialize(value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, Decimal):
            return float(value)
        if hasattr(value, "value"):  # Enum
            return value.value
        return value

    @staticmethod
    async def _validate_mileage_difference(task: Task, payload: Dict[str, Any]) -> None:
        """验收里程差异校验（PRD 2.2）"""
        acceptance_mileage = payload.get("acceptance_mileage")
        if not acceptance_mileage or not task.supplier_mileage:
            return  # 任一为空跳过
        diff_percentage = abs(float(acceptance_mileage) - float(task.supplier_mileage)) / float(task.supplier_mileage) * 100
        if diff_percentage > settings.MILEAGE_DIFFERENCE_THRESHOLD:
            if not payload.get("mileage_difference_explanation"):
                raise MileageDifferenceError(diff_percentage, settings.MILEAGE_DIFFERENCE_THRESHOLD)


state_machine_service = StateMachineService()
