"""结算接口"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user, require_roles
from app.models.settlement import Settlement
from app.models.user import User
from app.schemas.enums import UserRole

router = APIRouter(prefix="/settlements", tags=["结算"])


@router.get("")
async def list_settlements(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    q = select(Settlement).order_by(Settlement.created_at.desc())
    if current_user.role == UserRole.SUPPLIER:
        q = q.where(Settlement.supplier_id == current_user.supplier_id)
    rows = (await db.execute(q)).scalars().all()
    return [{
        "id": str(s.id), "bill_no": s.bill_no, "task_id": str(s.task_id), "supplier_id": s.supplier_id,
        "valid_count": s.valid_count, "reviewed_count": s.reviewed_count, "first_pass_count": s.first_pass_count,
        "ffr": float(s.ffr), "coef": float(s.coef), "base_amount": float(s.base_amount),
        "amount": float(s.amount), "status": s.status, "created_at": str(s.created_at),
    } for s in rows]


@router.post("/{sid}/confirm")
async def confirm_settlement(sid: uuid.UUID,
                             current_user: User = Depends(require_roles(UserRole.ADMIN)),
                             db: AsyncSession = Depends(get_db)):
    s = (await db.execute(select(Settlement).where(Settlement.id == sid))).scalar_one_or_none()
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="结算单不存在")
    if s.status != "PENDING":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="结算单状态不可确认")
    s.status = "CONFIRMED"
    s.confirmed_at = None  # 由数据库/now 填充
    from datetime import datetime, timezone
    s.confirmed_at = datetime.now(timezone.utc)
    await db.commit()
    return {"bill_no": s.bill_no, "status": "CONFIRMED", "amount": float(s.amount)}
