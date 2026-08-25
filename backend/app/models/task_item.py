import uuid
from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey, Index
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.models.base import Base
from app.schemas.enums import ItemStatus


class TaskItem(Base):
    """任务明细（老平台逻辑：标注/质检单位）"""
    __tablename__ = "task_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    item_name: Mapped[str] = mapped_column(String(200), nullable=False)
    data_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    status: Mapped[ItemStatus] = mapped_column(
        SQLEnum(ItemStatus, name="item_status", create_type=False, values_callable=lambda e: [m.value for m in e]),
        nullable=False, default=ItemStatus.PENDING,
    )
    fail_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    screenshot: Mapped[str | None] = mapped_column(String(500), nullable=True)
    annotator: Mapped[str | None] = mapped_column(String(50), nullable=True)
    claimed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    work_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_rework: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    error_types: Mapped[list | None] = mapped_column(JSONB, default=list, nullable=True)
    reject_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    submit_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rework_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    client_reviewed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    first_pass: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    history: Mapped[list | None] = mapped_column(JSONB, default=list, nullable=True)
    tags: Mapped[list | None] = mapped_column(JSONB, default=list, nullable=True)

    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    task: Mapped["Task"] = relationship("Task", back_populates="items")  # noqa: F821

    __table_args__ = (Index("idx_item_task", "task_id", "status"),)
