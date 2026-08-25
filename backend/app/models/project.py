import uuid
from sqlalchemy import String, Integer, DateTime, ForeignKey
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID
from app.models.base import Base
from app.schemas.enums import ProjectStatus


class Project(Base):
    """项目（老平台逻辑：任务分组）"""
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    client_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    annotate_type: Mapped[str] = mapped_column(String(100), nullable=False)
    sample_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    deadline: Mapped[str | None] = mapped_column(String(50), nullable=True)
    status: Mapped[ProjectStatus] = mapped_column(
        SQLEnum(ProjectStatus, name="project_status", create_type=False, values_callable=lambda e: [m.value for m in e]),
        nullable=False, default=ProjectStatus.ACTIVE,
    )
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    template: Mapped[str | None] = mapped_column(String(100), nullable=True)
    upload_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    dataset_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    tasks: Mapped[list["Task"]] = relationship("Task", back_populates="project")  # noqa: F821
