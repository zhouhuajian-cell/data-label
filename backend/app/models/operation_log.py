import uuid
from sqlalchemy import String, DateTime, ForeignKey, Index
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.models.base import Base
from app.schemas.enums import OperationType


class OperationLog(Base):
    """操作日志表（PRD 4.3，每次状态机流转必须记录）"""
    __tablename__ = "operation_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    operator_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    operation_type: Mapped[OperationType] = mapped_column(SQLEnum(OperationType, name="operation_type", create_type=False, values_callable=lambda e: [m.value for m in e]), nullable=False)
    previous_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    new_status: Mapped[str] = mapped_column(String(50), nullable=False)
    operation_details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(50), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    task: Mapped["Task"] = relationship("Task", back_populates="operation_logs")  # noqa: F821
    operator: Mapped["User"] = relationship("User", back_populates="operation_logs")  # noqa: F821

    __table_args__ = (Index("idx_task_created", "task_id", "created_at"),)
