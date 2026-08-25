import uuid
from sqlalchemy import String, Boolean, DateTime, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.models.base import Base
from app.schemas.enums import UserRole


class User(Base):
    """用户表（PRD 4.1）"""
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    email: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(SQLEnum(UserRole, name="user_role", create_type=False, values_callable=lambda e: [m.value for m in e]), nullable=False)
    supplier_id: Mapped[str | None] = mapped_column(String(50), index=True, nullable=True)  # SUPPLIER 必填
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    created_tasks: Mapped[list["Task"]] = relationship(  # noqa: F821
        "Task", back_populates="creator", foreign_keys="Task.created_by"
    )
    operation_logs: Mapped[list["OperationLog"]] = relationship(  # noqa: F821
        "OperationLog", back_populates="operator"
    )
