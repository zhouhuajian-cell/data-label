import uuid
from decimal import Decimal
from sqlalchemy import String, DECIMAL, Integer, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID
from app.models.base import Base


class Settlement(Base):
    """结算单（老平台逻辑：任务验收通过后生成，按样本×单价×质量系数）"""
    __tablename__ = "settlements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    bill_no: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    supplier_id: Mapped[str] = mapped_column(String(50), nullable=False)

    unit_price: Mapped[float | None] = mapped_column(DECIMAL(12, 3), nullable=True)
    valid_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reviewed_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    first_pass_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    ffr: Mapped[float] = mapped_column(DECIMAL(8, 4), default=0, nullable=False)
    coef: Mapped[float] = mapped_column(DECIMAL(8, 4), default=0, nullable=False)
    base_amount: Mapped[float] = mapped_column(DECIMAL(12, 2), default=0, nullable=False)
    amount: Mapped[float] = mapped_column(DECIMAL(12, 2), default=0, nullable=False)
    rejected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    status: Mapped[str] = mapped_column(String(20), default="PENDING", nullable=False)  # PENDING / CONFIRMED / REJECTED
    confirmed_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    task: Mapped["Task"] = relationship("Task")  # noqa: F821

    __table_args__ = (Index("idx_settlement_task", "task_id"),)
