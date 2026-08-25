"""看板接口"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.dashboard import get_dashboard

router = APIRouter(prefix="/dashboard", tags=["看板"])


@router.get("")
async def dashboard(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await get_dashboard(current_user, db)
