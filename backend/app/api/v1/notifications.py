"""消息通知接口"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.notification import Notification
from app.models.user import User

router = APIRouter(prefix="/notifications", tags=["消息通知"])


@router.get("")
async def list_notifications(
    unread_only: bool = False, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    q = select(Notification).where(Notification.user_id == current_user.id)
    if unread_only:
        q = q.where(Notification.is_read.is_(False))
    q = q.order_by(Notification.created_at.desc()).limit(50)
    rows = (await db.execute(q)).scalars().all()
    unread = (await db.execute(
        select(Notification.id).where(Notification.user_id == current_user.id, Notification.is_read.is_(False))
    )).scalars().all()
    return {
        "items": [{
            "id": str(n.id), "type": n.type, "title": n.title, "content": n.content,
            "ref_type": n.ref_type, "ref_id": n.ref_id, "is_read": n.is_read, "created_at": str(n.created_at),
        } for n in rows],
        "unread": len(unread),
    }


@router.put("/{nid}/read")
async def mark_read(nid: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    n = (await db.execute(select(Notification).where(Notification.id == nid, Notification.user_id == current_user.id))).scalar_one_or_none()
    if n is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="消息不存在")
    n.is_read = True
    await db.commit()
    return {"ok": True}


@router.put("/read-all")
async def mark_all_read(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(update(Notification).where(Notification.user_id == current_user.id).values(is_read=True))
    await db.commit()
    return {"ok": True}
