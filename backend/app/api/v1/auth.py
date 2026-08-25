"""认证接口（PRD 5.1）"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import create_access_token, get_password_hash, verify_password
from app.models.user import User
from app.schemas.auth import LoginRequest, LoginResponse, RegisterRequest
from app.schemas.enums import UserRole

router = APIRouter(prefix="/auth", tags=["认证"])


@router.post("/login", response_model=LoginResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == data.username, User.is_active.is_(True)))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    token = create_access_token({"sub": str(user.id)})
    return LoginResponse(
        access_token=token, user_id=str(user.id), username=user.username,
        role=user.role, supplier_id=user.supplier_id,
    )


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """用户注册（简化版；生产需管理员审批，PRD 3.4）"""
    if data.role == UserRole.SUPPLIER and not data.supplier_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="供应商角色必须填写 supplier_id")

    existing = await db.execute(
        select(User.id).where((User.username == data.username) | (User.email == data.email))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="用户名或邮箱已存在")

    user = User(
        username=data.username, email=data.email,
        hashed_password=get_password_hash(data.password),
        role=data.role, supplier_id=data.supplier_id,
    )
    db.add(user)
    await db.commit()
    return {"message": "注册成功"}
