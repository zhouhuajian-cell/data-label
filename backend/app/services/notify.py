"""站内通知工具"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.models.task import Task
from app.models.user import User
from app.schemas.enums import UserRole


async def notify_user(db: AsyncSession, user_id, type, title, content, ref_type=None, ref_id=None):
    db.add(Notification(user_id=user_id, type=type, title=title, content=content, ref_type=ref_type, ref_id=ref_id))
    await db.commit()


async def notify_suppliers(db: AsyncSession, task: Task, type, title, content):
    """通知该任务供应商的所有 SUPPLIER 账号"""
    users = (await db.execute(
        select(User.id).where(User.role == UserRole.SUPPLIER,
                              User.supplier_id == task.supplier_id,
                              User.is_active.is_(True))
    )).scalars().all()
    for uid in users:
        db.add(Notification(user_id=uid, type=type, title=title, content=content, ref_type="task", ref_id=str(task.id)))
    if users:
        await db.commit()
