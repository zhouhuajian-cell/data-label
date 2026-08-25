"""数据级别权限：供应商隔离（PRD 2.4）"""
import uuid
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.user import User
from app.models.task import Task
from app.schemas.enums import UserRole


async def check_task_access(task_id: uuid.UUID, current_user: User, db: AsyncSession) -> Task:
    """校验任务是否存在 + 供应商数据隔离"""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")

    if current_user.role == UserRole.SUPPLIER and task.supplier_id != current_user.supplier_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该任务")
    return task


def build_supplier_filter(current_user: User):
    """供应商只能查自己任务；其他角色全量"""
    if current_user.role == UserRole.SUPPLIER:
        return Task.supplier_id == current_user.supplier_id
    return True
