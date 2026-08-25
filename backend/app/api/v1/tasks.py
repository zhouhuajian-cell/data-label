"""任务接口（PRD 5.2）：创建/列表/详情 + 全部状态流转接口"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import VersionConflictError
from app.core.permissions import check_task_access
from app.core.redis_service import redis_service
from app.core.security import get_current_user, require_roles
from app.models.operation_log import OperationLog
from app.models.task import Task
from app.models.user import User
from app.schemas.enums import OperationType, TaskStatus, UserRole
from app.schemas.task import (
    TaskAcceptanceRequest, TaskCreateRequest, TaskListRequest, TaskListResponse,
    TaskOptimizationRequest, TaskPerceptionUsageRequest, TaskRejectRequest,
    TaskRepairRequest, TaskResponse, TaskSupplierSubmitRequest, TaskWarehouseRequest,
)
from app.services.state_machine import state_machine_service
from app.services.task_service import TaskService

router = APIRouter(prefix="/tasks", tags=["任务管理"])


def _client_meta(request: Request) -> tuple[Optional[str], Optional[str]]:
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")
    return ip, ua


# ========== 创建 / 列表 / 详情 ==========

@router.post("", response_model=TaskResponse, status_code=201)
async def create_task(
    data: TaskCreateRequest, request: Request,
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    ip, ua = _client_meta(request)
    return await TaskService.create_task(data, current_user, db, ip, ua)


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None), supplier_id: Optional[str] = Query(None),
    city: Optional[str] = Query(None), data_type: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    params = TaskListRequest(
        page=page, page_size=page_size, status=status, supplier_id=supplier_id,
        city=city, data_type=data_type, keyword=keyword,
    )
    tasks, total = await TaskService.get_task_list(params, current_user, db)
    return TaskListResponse(total=total, page=params.page, page_size=params.page_size, items=tasks)


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task_detail(
    task_id: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    return await check_task_access(task_id, current_user, db)


@router.get("/{task_id}/operation-logs")
async def get_operation_logs(
    task_id: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    task = await check_task_access(task_id, current_user, db)
    result = await db.execute(
        select(OperationLog).where(OperationLog.task_id == task.id).order_by(OperationLog.created_at.desc())
    )
    return result.scalars().all()


# ========== 状态流转通用执行器 ==========

async def _run_transition(
    task_id: uuid.UUID, operation: OperationType, payload: dict,
    current_user: User, db: AsyncSession, request: Request,
) -> Task:
    """角色已由各路由 require_roles 保证；此处：Redis 锁 → 权限校验 → 状态机流转"""
    await redis_service.acquire_submit_lock(str(task_id), str(current_user.id), operation.value)
    try:
        task = await check_task_access(task_id, current_user, db)
        ip, ua = _client_meta(request)
        return await state_machine_service.transition(db, task, operation, current_user, payload, ip, ua)
    finally:
        await redis_service.release_submit_lock(str(task_id), str(current_user.id), operation.value)


# ========== 状态流转接口（PRD 5.2） ==========

@router.post("/{task_id}/submit-to-taixing", response_model=TaskResponse)
async def submit_to_taixing(task_id: uuid.UUID, data: TaskSupplierSubmitRequest,
                            request: Request, current_user: User = Depends(require_roles(UserRole.SUPPLIER)),
                            db: AsyncSession = Depends(get_db)):
    return await _run_transition(task_id, OperationType.SUBMIT_TO_TAIXING, data.model_dump(), current_user, db, request)


@router.post("/{task_id}/start-optimization", response_model=TaskResponse)
async def start_optimization(task_id: uuid.UUID, data: TaskOptimizationRequest,
                             request: Request, current_user: User = Depends(require_roles(UserRole.OPTIMIZER)),
                             db: AsyncSession = Depends(get_db)):
    payload = data.model_dump()
    payload["need_optimization"] = True
    return await _run_transition(task_id, OperationType.START_OPTIMIZATION, payload, current_user, db, request)


@router.post("/{task_id}/skip-optimization", response_model=TaskResponse)
async def skip_optimization(task_id: uuid.UUID, data: TaskOptimizationRequest,
                            request: Request, current_user: User = Depends(require_roles(UserRole.OPTIMIZER)),
                            db: AsyncSession = Depends(get_db)):
    payload = data.model_dump()
    payload["need_optimization"] = False
    return await _run_transition(task_id, OperationType.SKIP_OPTIMIZATION, payload, current_user, db, request)


@router.post("/{task_id}/complete-optimization", response_model=TaskResponse)
async def complete_optimization(task_id: uuid.UUID, data: TaskOptimizationRequest,
                                request: Request, current_user: User = Depends(require_roles(UserRole.OPTIMIZER)),
                                db: AsyncSession = Depends(get_db)):
    payload = data.model_dump()
    payload["need_optimization"] = True
    if not payload.get("optimization_method"):
        raise HTTPException(status_code=400, detail="缺少必填字段: optimization_method")
    return await _run_transition(task_id, OperationType.COMPLETE_OPTIMIZATION, payload, current_user, db, request)


@router.post("/{task_id}/accept", response_model=TaskResponse)
async def accept(task_id: uuid.UUID, data: TaskAcceptanceRequest,
                 request: Request, current_user: User = Depends(require_roles(UserRole.ACCEPTOR)),
                 db: AsyncSession = Depends(get_db)):
    """验收通过；ACCEPTED 后自动生成结算单"""
    await redis_service.acquire_submit_lock(str(task_id), str(current_user.id), OperationType.ACCEPT.value)
    try:
        task = await check_task_access(task_id, current_user, db)
        ip, ua = _client_meta(request)
        updated = await state_machine_service.transition(db, task, OperationType.ACCEPT, current_user, data.model_dump(), ip, ua)
        if updated.status == TaskStatus.ACCEPTED:
            from app.services.settlement import auto_generate
            await auto_generate(updated, db)
        return updated
    finally:
        await redis_service.release_submit_lock(str(task_id), str(current_user.id), OperationType.ACCEPT.value)


@router.post("/{task_id}/reject", response_model=TaskResponse)
async def reject(task_id: uuid.UUID, data: TaskRejectRequest,
                 request: Request, current_user: User = Depends(require_roles(UserRole.ACCEPTOR)),
                 db: AsyncSession = Depends(get_db)):
    return await _run_transition(task_id, OperationType.REJECT, data.model_dump(), current_user, db, request)


@router.post("/{task_id}/resubmit", response_model=TaskResponse)
async def resubmit(task_id: uuid.UUID, data: TaskSupplierSubmitRequest,
                   request: Request, current_user: User = Depends(require_roles(UserRole.SUPPLIER)),
                   db: AsyncSession = Depends(get_db)):
    return await _run_transition(task_id, OperationType.RESUBMIT, data.model_dump(), current_user, db, request)


@router.post("/{task_id}/warehouse", response_model=TaskResponse)
async def warehouse(task_id: uuid.UUID, data: TaskWarehouseRequest,
                    request: Request, current_user: User = Depends(require_roles(UserRole.ADMIN)),
                    db: AsyncSession = Depends(get_db)):
    return await _run_transition(task_id, OperationType.WAREHOUSE, data.model_dump(), current_user, db, request)


@router.post("/{task_id}/request-repair", response_model=TaskResponse)
async def request_repair(task_id: uuid.UUID, data: TaskRepairRequest,
                         request: Request, current_user: User = Depends(require_roles(UserRole.PERCEPTION)),
                         db: AsyncSession = Depends(get_db)):
    return await _run_transition(task_id, OperationType.REQUEST_REPAIR, data.model_dump(), current_user, db, request)


@router.post("/{task_id}/complete-repair", response_model=TaskResponse)
async def complete_repair(task_id: uuid.UUID, data: TaskSupplierSubmitRequest,
                          request: Request, current_user: User = Depends(require_roles(UserRole.SUPPLIER)),
                          db: AsyncSession = Depends(get_db)):
    return await _run_transition(task_id, OperationType.COMPLETE_REPAIR, data.model_dump(), current_user, db, request)


@router.put("/{task_id}/perception-usage", response_model=TaskResponse)
async def update_perception_usage(task_id: uuid.UUID, data: TaskPerceptionUsageRequest,
                                  request: Request, current_user: User = Depends(require_roles(UserRole.PERCEPTION)),
                                  db: AsyncSession = Depends(get_db)):
    """感知团队更新使用状态（不改变任务状态）"""
    await redis_service.acquire_submit_lock(str(task_id), str(current_user.id), "UPDATE_PERCEPTION_USAGE")
    try:
        task = await check_task_access(task_id, current_user, db)
        ip, ua = _client_meta(request)
        return await state_machine_service.update_perception_usage(
            db, task, current_user, data.model_dump(), ip, ua
        )
    finally:
        await redis_service.release_submit_lock(str(task_id), str(current_user.id), "UPDATE_PERCEPTION_USAGE")


@router.post("/{task_id}/dispatch", response_model=TaskResponse)
async def dispatch(task_id: uuid.UUID, data: TaskWarehouseRequest,
                   request: Request, current_user: User = Depends(require_roles(UserRole.ADMIN)),
                   db: AsyncSession = Depends(get_db)):
    """派发任务给供应商（老流程：UNASSIGNED → ANNOTATING）"""
    task = await _run_transition(task_id, OperationType.DISPATCH, data.model_dump(), current_user, db, request)
    from app.services.notify import notify_suppliers
    await notify_suppliers(db, task, "dispatch", "新任务派发", f"任务「{task.task_name or task.measurement_area_name}」已派发给您，请处理")
    return task


@router.post("/{task_id}/complete-work", response_model=TaskResponse)
async def complete_work(task_id: uuid.UUID, data: TaskWarehouseRequest,
                        request: Request, current_user: User = Depends(require_roles(UserRole.SUPPLIER)),
                        db: AsyncSession = Depends(get_db)):
    """供应商标注完成（老流程：ANNOTATING → VENDOR_QA）"""
    return await _run_transition(task_id, OperationType.COMPLETE_WORK, data.model_dump(), current_user, db, request)
