import uuid
from sqlalchemy import String, DECIMAL, Boolean, Integer, Text, DateTime, ForeignKey, CheckConstraint, Index
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID
from app.models.base import Base
from app.schemas.enums import TaskStatus, DataType, RoadScene


class Task(Base):
    """测区任务主表（PRD 4.2）"""
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    measurement_area_name: Mapped[str] = mapped_column(String(200), unique=True, index=True, nullable=False)  # 全局唯一测区名

    # ===== 源头业务数据（管理员创建，只读） =====
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    vehicle_model: Mapped[str] = mapped_column(String(100), nullable=False)
    data_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    data_type: Mapped[DataType] = mapped_column(SQLEnum(DataType, name="data_type", create_type=False, values_callable=lambda e: [m.value for m in e]), nullable=False)
    source_data_path: Mapped[str] = mapped_column(Text, nullable=False)  # 只读
    task_index_path: Mapped[str] = mapped_column(Text, nullable=False)  # 只读
    initial_road_scene: Mapped[RoadScene] = mapped_column(SQLEnum(RoadScene, name="road_scene", create_type=False, values_callable=lambda e: [m.value for m in e]), nullable=False)  # 不可变

    # ===== 供应商协作字段 =====
    supplier_id: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    supplier_mileage: Mapped[float | None] = mapped_column(DECIMAL(12, 3), nullable=True)
    supplier_road_scene: Mapped[RoadScene | None] = mapped_column(SQLEnum(RoadScene, name="road_scene", create_type=False, values_callable=lambda e: [m.value for m in e]), nullable=True)

    # ===== 泰兴/感知协作字段 =====
    need_optimization: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    optimization_method: Mapped[str | None] = mapped_column(String(200), nullable=True)
    acceptance_mileage: Mapped[float | None] = mapped_column(DECIMAL(12, 3), nullable=True)
    acceptance_road_scene: Mapped[RoadScene | None] = mapped_column(SQLEnum(RoadScene, name="road_scene", create_type=False, values_callable=lambda e: [m.value for m in e]), nullable=True)
    perception_usage_status: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ===== 流转与审计 =====
    status: Mapped[TaskStatus] = mapped_column(
        SQLEnum(TaskStatus, name="task_status", create_type=False, values_callable=lambda e: [m.value for m in e]), nullable=False, default=TaskStatus.ANNOTATING, index=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)  # 乐观锁
    repair_round: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # ===== 驳回/返修/里程差异说明 =====
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    repair_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    mileage_difference_explanation: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ===== 创建/更新 =====
    # ===== 老平台流程字段（项目/派发/明细） =====
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id"), nullable=True, index=True)
    task_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    nano_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    annotate_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sample_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    unit_price: Mapped[float | None] = mapped_column(DECIMAL(12, 3), nullable=True)
    total_price: Mapped[float | None] = mapped_column(DECIMAL(12, 3), nullable=True)
    deadline: Mapped[str | None] = mapped_column(String(50), nullable=True)
    qa_standard: Mapped[str | None] = mapped_column(Text, nullable=True)
    upload_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    current_rework: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reject_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    qa_sampling_rate: Mapped[float] = mapped_column(Integer, default=1.0, nullable=False)
    submit_time: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
    accept_time: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    creator: Mapped["User"] = relationship("User", back_populates="created_tasks", foreign_keys=[created_by])  # noqa: F821
    operation_logs: Mapped[list["OperationLog"]] = relationship(  # noqa: F821
        "OperationLog", back_populates="task", cascade="all, delete-orphan"
    )
    field_changes: Mapped[list["FieldChangeHistory"]] = relationship(  # noqa: F821
        "FieldChangeHistory", back_populates="task", cascade="all, delete-orphan"
    )

    project: Mapped["Project | None"] = relationship("Project", back_populates="tasks")  # noqa: F821
    items: Mapped[list["TaskItem"]] = relationship("TaskItem", back_populates="task", cascade="all, delete-orphan")  # noqa: F821

    __table_args__ = (
        CheckConstraint("supplier_mileage >= 0", name="check_supplier_mileage_positive"),
        CheckConstraint("acceptance_mileage >= 0", name="check_acceptance_mileage_positive"),
        CheckConstraint("repair_round >= 0", name="check_repair_round_non_negative"),
        Index("idx_supplier_status", "supplier_id", "status"),
        Index("idx_created_at", "created_at"),
    )
