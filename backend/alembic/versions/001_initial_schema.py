"""Initial schema（PRD 4：users / tasks / operation_logs / field_change_history）

Revision ID: 001
Revises:
Create Date: 2024-01-01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("username", sa.String(50), nullable=False, unique=True),
        sa.Column("email", sa.String(100), nullable=False, unique=True),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("role", sa.Enum('ADMIN', 'SUPPLIER', 'OPTIMIZER', 'ACCEPTOR', 'PERCEPTION', name='user_role'), nullable=False),
        sa.Column("supplier_id", sa.String(50), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_username", "users", ["username"])
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index("ix_users_supplier_id", "users", ["supplier_id"])

    op.create_table(
        "tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("measurement_area_name", sa.String(200), nullable=False, unique=True),
        sa.Column("city", sa.String(100), nullable=False),
        sa.Column("vehicle_model", sa.String(100), nullable=False),
        sa.Column("data_version", sa.String(50), nullable=True),
        sa.Column("data_type", sa.Enum('建图A', '建图B', '建图C', name='data_type'), nullable=False),
        sa.Column("source_data_path", sa.Text, nullable=False),
        sa.Column("task_index_path", sa.Text, nullable=False),
        sa.Column("initial_road_scene", sa.Enum('城区', '高速', '郊区', '混合', name='road_scene'), nullable=False),
        sa.Column("supplier_id", sa.String(50), nullable=False),
        sa.Column("supplier_mileage", sa.DECIMAL(12, 3), nullable=True),
        sa.Column("supplier_road_scene", sa.Enum('城区', '高速', '郊区', '混合', name='road_scene'), nullable=True),
        sa.Column("need_optimization", sa.Boolean, nullable=True),
        sa.Column("optimization_method", sa.String(200), nullable=True),
        sa.Column("acceptance_mileage", sa.DECIMAL(12, 3), nullable=True),
        sa.Column("acceptance_road_scene", sa.Enum('城区', '高速', '郊区', '混合', name='road_scene'), nullable=True),
        sa.Column("perception_usage_status", sa.Text, nullable=True),
        sa.Column("status", sa.Enum('ANNOTATING', 'WAITING_OPTIMIZATION', 'OPTIMIZING', 'WAITING_ACCEPTANCE', 'ACCEPTED', 'REJECTED', 'WAREHOUSED', 'REPAIR_REQUIRED', name='task_status'), nullable=False, server_default="ANNOTATING"),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("repair_round", sa.Integer, nullable=False, server_default="0"),
        sa.Column("reject_reason", sa.Text, nullable=True),
        sa.Column("repair_reason", sa.Text, nullable=True),
        sa.Column("mileage_difference_explanation", sa.Text, nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.CheckConstraint("supplier_mileage >= 0", name="check_supplier_mileage_positive"),
        sa.CheckConstraint("acceptance_mileage >= 0", name="check_acceptance_mileage_positive"),
        sa.CheckConstraint("repair_round >= 0", name="check_repair_round_non_negative"),
    )
    op.create_index("ix_tasks_measurement_area_name", "tasks", ["measurement_area_name"])
    op.create_index("ix_tasks_supplier_id", "tasks", ["supplier_id"])
    op.create_index("ix_tasks_status", "tasks", ["status"])
    op.create_index("idx_supplier_status", "tasks", ["supplier_id", "status"])
    op.create_index("idx_created_at", "tasks", ["created_at"])

    op.create_table(
        "operation_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("operator_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("operation_type", sa.Enum('CREATE', 'SUBMIT_TO_TAIXING', 'START_OPTIMIZATION', 'SKIP_OPTIMIZATION', 'COMPLETE_OPTIMIZATION', 'ACCEPT', 'REJECT', 'RESUBMIT', 'WAREHOUSE', 'REQUEST_REPAIR', 'COMPLETE_REPAIR', 'UPDATE_PERCEPTION_USAGE', name='operation_type'), nullable=False),
        sa.Column("previous_status", sa.String(50), nullable=True),
        sa.Column("new_status", sa.String(50), nullable=False),
        sa.Column("operation_details", postgresql.JSONB, nullable=True),
        sa.Column("ip_address", sa.String(50), nullable=True),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_operation_logs_task_id", "operation_logs", ["task_id"])
    op.create_index("ix_operation_logs_created_at", "operation_logs", ["created_at"])
    op.create_index("idx_task_created", "operation_logs", ["task_id", "created_at"])

    op.create_table(
        "field_change_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("operator_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("field_name", sa.String(100), nullable=False),
        sa.Column("field_type", sa.String(50), nullable=False),
        sa.Column("old_value", postgresql.JSONB, nullable=True),
        sa.Column("new_value", postgresql.JSONB, nullable=True),
        sa.Column("changed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_field_change_history_task_id", "field_change_history", ["task_id"])
    op.create_index("ix_field_change_history_changed_at", "field_change_history", ["changed_at"])
    op.create_index("idx_task_field_changed", "field_change_history", ["task_id", "field_name", "changed_at"])


def downgrade() -> None:
    op.drop_table("field_change_history")
    op.drop_table("operation_logs")
    op.drop_table("tasks")
    op.drop_table("users")
    op.execute("DROP TYPE operation_type")
    op.execute("DROP TYPE road_scene")
    op.execute("DROP TYPE data_type")
    op.execute("DROP TYPE task_status")
    op.execute("DROP TYPE user_role")
