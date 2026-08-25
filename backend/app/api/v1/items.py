"""任务明细 + 标注/质检工作台"""
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import check_task_access
from app.core.security import get_current_user, require_roles
from app.models.task_item import TaskItem
from app.models.task import Task
from app.models.user import User
from app.schemas.enums import ItemStatus, UserRole
from app.schemas.item import ItemImportRequest, ItemQaRequest, ItemResponse, ItemUpdateRequest

router = APIRouter(tags=["任务明细/工作台"])


async def _get_item(item_id: uuid.UUID, db: AsyncSession) -> TaskItem:
    item = (await db.execute(select(TaskItem).where(TaskItem.id == item_id))).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="明细不存在")
    return item


@router.get("/tasks/{task_id}/items", response_model=list[ItemResponse])
async def list_items(
    task_id: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    await check_task_access(task_id, current_user, db)
    result = await db.execute(select(TaskItem).where(TaskItem.task_id == task_id).order_by(TaskItem.created_at))
    return result.scalars().all()


@router.post("/tasks/{task_id}/items/import", status_code=201)
async def import_items(
    task_id: uuid.UUID, data: ItemImportRequest,
    current_user: User = Depends(require_roles(UserRole.ADMIN)), db: AsyncSession = Depends(get_db),
):
    task = await check_task_access(task_id, current_user, db)
    imported = 0
    for row in data.rows:
        item_name = str(row.get("item_name") or row.get("明细名称") or "").strip()
        if not item_name:
            continue
        db.add(TaskItem(
            task_id=task.id, item_name=item_name,
            data_type=str(row.get("data_type") or row.get("数据类型") or "").strip(),
            status=ItemStatus.PENDING,
            fail_reason=str(row.get("fail_reason") or row.get("备注") or "").strip(),
            annotator=str(row.get("annotator") or row.get("标注人") or "").strip(),
            history=[],
        ))
        imported += 1
    await db.commit()
    return {"imported": imported}


@router.post("/items/{item_id}/claim", response_model=ItemResponse)
async def claim_item(
    item_id: uuid.UUID, current_user: User = Depends(require_roles(UserRole.SUPPLIER)), db: AsyncSession = Depends(get_db),
):
    """标注员领取明细"""
    item = await _get_item(item_id, db)
    task = (await db.execute(select(Task).where(Task.id == item.task_id))).scalar_one()
    if current_user.supplier_id != task.supplier_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权操作其他供应商的明细")
    if item.claimed_by:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="明细已被领取")
    item.claimed_by = current_user.id
    item.annotator = current_user.username
    item.status = ItemStatus.ANNOTATING
    item.history = (item.history or []) + [{"action": "claim", "actor": current_user.username, "time": str(datetime.utcnow())}]
    await db.commit()
    await db.refresh(item)
    return item


@router.post("/items/{item_id}/submit", response_model=ItemResponse)
async def submit_item(
    item_id: uuid.UUID, current_user: User = Depends(require_roles(UserRole.SUPPLIER)), db: AsyncSession = Depends(get_db),
):
    """标注员提交明细"""
    item = await _get_item(item_id, db)
    task = (await db.execute(select(Task).where(Task.id == item.task_id))).scalar_one()
    if current_user.supplier_id != task.supplier_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权操作其他供应商的明细")
    if item.status != ItemStatus.ANNOTATING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前明细状态不可提交")
    item.status = ItemStatus.SUBMITTED
    item.submit_count = (item.submit_count or 0) + 1
    item.history = (item.history or []) + [{"action": "submit", "actor": current_user.username, "time": str(datetime.utcnow())}]
    await db.commit()
    await db.refresh(item)
    return item


@router.post("/items/{item_id}/vendor-qa", response_model=ItemResponse)
async def vendor_qa(
    item_id: uuid.UUID, data: ItemQaRequest,
    current_user: User = Depends(require_roles(UserRole.SUPPLIER)), db: AsyncSession = Depends(get_db),
):
    """供应商质检：通过→vendor_passed；驳回→rework"""
    item = await _get_item(item_id, db)
    if item.status != ItemStatus.SUBMITTED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前明细状态不可质检")
    item.status = ItemStatus.VENDOR_PASSED if data.passed else ItemStatus.REWORK
    item.reject_note = data.reject_note
    if not data.passed:
        item.rework_count = (item.rework_count or 0) + 1
        item.is_rework = True
    item.history = (item.history or []) + [{"action": "vendor_qa", "actor": current_user.username, "passed": data.passed, "time": str(datetime.utcnow())}]
    await db.commit()
    await db.refresh(item)
    return item


@router.post("/items/{item_id}/client-qa", response_model=ItemResponse)
async def client_qa(
    item_id: uuid.UUID, data: ItemQaRequest,
    current_user: User = Depends(require_roles(UserRole.ADMIN)), db: AsyncSession = Depends(get_db),
):
    """甲方验收：通过→accepted；驳回→rework"""
    item = await _get_item(item_id, db)
    item.status = ItemStatus.ACCEPTED if data.passed else ItemStatus.REWORK
    item.client_reviewed = True
    item.first_pass = data.passed and (item.rework_count or 0) == 0
    if not data.passed:
        item.rework_count = (item.rework_count or 0) + 1
        item.is_rework = True
    item.reject_note = data.reject_note
    item.history = (item.history or []) + [{"action": "client_qa", "actor": current_user.username, "passed": data.passed, "time": str(datetime.utcnow())}]
    await db.commit()
    await db.refresh(item)
    return item
