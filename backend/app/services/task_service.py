"""任务服务（创建/列表/详情 + 查询辅助）"""
import uuid
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.operation_log import OperationLog
from app.models.task import Task
from app.models.user import User
from app.schemas.enums import OperationType, TaskStatus
from app.schemas.task import TaskCreateRequest, TaskListRequest
from app.core.permissions import build_supplier_filter


class TaskService:

    @staticmethod
    async def create_task(
        data: TaskCreateRequest, creator: User, db: AsyncSession,
        ip_address: Optional[str] = None, user_agent: Optional[str] = None,
    ) -> Task:
        """创建任务（仅 ADMIN）。按 PRD 3.2 必须写 CREATE 操作日志。"""
        # 测区名唯一（友好提示；DB 层另有唯一约束兜底）
        existing = await db.execute(
            select(Task.id).where(Task.measurement_area_name == data.measurement_area_name)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "MEASUREMENT_AREA_DUPLICATE",
                        "message": f"测区名称 '{data.measurement_area_name}' 已存在"},
            )

        task = Task(
            measurement_area_name=data.measurement_area_name,
            city=data.city, vehicle_model=data.vehicle_model, data_version=data.data_version,
            data_type=data.data_type, source_data_path=data.source_data_path,
            task_index_path=data.task_index_path, initial_road_scene=data.initial_road_scene,
            supplier_id=data.supplier_id,
            status=TaskStatus.UNASSIGNED,  # 融合：初始待派发（老流程），ADMIN 派发后 ANNOTATING
            version=1, repair_round=0,
            created_by=creator.id,
        )
        db.add(task)
        await db.flush()  # 取 task.id

        db.add(OperationLog(
            task_id=task.id, operator_id=creator.id, operation_type=OperationType.CREATE,
            previous_status=None, new_status=TaskStatus.UNASSIGNED.value,
            operation_details={"measurement_area_name": task.measurement_area_name},
            ip_address=ip_address, user_agent=user_agent,
        ))

        await db.commit()
        await db.refresh(task)
        return task

    @staticmethod
    async def get_task_list(
        params: TaskListRequest, current_user: User, db: AsyncSession,
    ) -> tuple[list[Task], int]:
        """任务列表：分页/筛选/供应商隔离"""
        query = select(Task)
        count_query = select(func.count(Task.id))

        supplier_filter = build_supplier_filter(current_user)
        query = query.where(supplier_filter)
        count_query = count_query.where(supplier_filter)

        if params.status:
            query = query.where(Task.status == params.status)
            count_query = count_query.where(Task.status == params.status)
        if params.supplier_id:
            query = query.where(Task.supplier_id == params.supplier_id)
            count_query = count_query.where(Task.supplier_id == params.supplier_id)
        if params.city:
            query = query.where(Task.city == params.city)
            count_query = count_query.where(Task.city == params.city)
        if params.data_type:
            query = query.where(Task.data_type == params.data_type)
            count_query = count_query.where(Task.data_type == params.data_type)
        if params.keyword:
            kw = Task.measurement_area_name.ilike(f"%{params.keyword}%")
            query = query.where(kw)
            count_query = count_query.where(kw)

        total_result = await db.execute(count_query)
        total = total_result.scalar()

        query = query.order_by(Task.created_at.desc())
        query = query.offset((params.page - 1) * params.page_size).limit(params.page_size)
        result = await db.execute(query)
        return list(result.scalars().all()), total
