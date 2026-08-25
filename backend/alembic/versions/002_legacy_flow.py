"""老平台流程：projects / task_items 表 + tasks 老字段

Revision ID: 002
Revises: 001
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:

    # projects 表
    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("client_name", sa.String(100), nullable=True),
        sa.Column("annotate_type", sa.String(100), nullable=False),
        sa.Column("sample_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("deadline", sa.String(50), nullable=True),
        sa.Column("status", sa.Enum('active', 'done', 'archived', name='project_status'), nullable=False, server_default="active"),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("template", sa.String(100), nullable=True),
        sa.Column("upload_path", sa.String(500), nullable=True),
        sa.Column("dataset_id", sa.String(100), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # task_items 表
    op.create_table(
        "task_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("item_name", sa.String(200), nullable=False),
        sa.Column("data_type", sa.String(50), nullable=True),
        sa.Column("status", sa.Enum('pending', 'annotating', 'annotated', 'vendor_passed', 'submitted', 'accepted', 'rework', name='item_status'), nullable=False, server_default="pending"),
        sa.Column("fail_reason", sa.String(500), nullable=True),
        sa.Column("screenshot", sa.String(500), nullable=True),
        sa.Column("annotator", sa.String(50), nullable=True),
        sa.Column("claimed_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("work_seconds", sa.Integer, nullable=False, server_default="0"),
        sa.Column("is_rework", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("error_types", postgresql.JSONB, nullable=True),
        sa.Column("reject_note", sa.String(500), nullable=True),
        sa.Column("submit_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("rework_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("client_reviewed", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("first_pass", sa.Boolean, nullable=True),
        sa.Column("history", postgresql.JSONB, nullable=True),
        sa.Column("tags", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index("ix_task_items_task_id", "task_items", ["task_id"])
    op.create_index("idx_item_task", "task_items", ["task_id", "status"])

    # tasks 加老流程字段
    op.add_column("tasks", sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=True))
    op.add_column("tasks", sa.Column("task_name", sa.String(200), nullable=True))
    op.add_column("tasks", sa.Column("nano_id", sa.String(50), nullable=True))
    op.add_column("tasks", sa.Column("annotate_type", sa.String(50), nullable=True))
    op.add_column("tasks", sa.Column("sample_count", sa.Integer, nullable=False, server_default="0"))
    op.add_column("tasks", sa.Column("unit_price", sa.DECIMAL(12, 3), nullable=True))
    op.add_column("tasks", sa.Column("total_price", sa.DECIMAL(12, 3), nullable=True))
    op.add_column("tasks", sa.Column("deadline", sa.String(50), nullable=True))
    op.add_column("tasks", sa.Column("qa_standard", sa.Text, nullable=True))
    op.add_column("tasks", sa.Column("upload_path", sa.String(500), nullable=True))
    op.add_column("tasks", sa.Column("current_rework", sa.Integer, nullable=False, server_default="0"))
    op.add_column("tasks", sa.Column("reject_count", sa.Integer, nullable=False, server_default="0"))
    op.add_column("tasks", sa.Column("qa_sampling_rate", sa.Integer, nullable=False, server_default="1"))
    op.add_column("tasks", sa.Column("submit_time", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("accept_time", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_tasks_project_id", "tasks", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_tasks_project_id", table_name="tasks")
    op.drop_column("tasks", "accept_time")
    op.drop_column("tasks", "submit_time")
    op.drop_column("tasks", "qa_sampling_rate")
    op.drop_column("tasks", "reject_count")
    op.drop_column("tasks", "current_rework")
    op.drop_column("tasks", "upload_path")
    op.drop_column("tasks", "qa_standard")
    op.drop_column("tasks", "deadline")
    op.drop_column("tasks", "total_price")
    op.drop_column("tasks", "unit_price")
    op.drop_column("tasks", "sample_count")
    op.drop_column("tasks", "annotate_type")
    op.drop_column("tasks", "nano_id")
    op.drop_column("tasks", "task_name")
    op.drop_column("tasks", "project_id")
    op.drop_index("idx_item_task", table_name="task_items")
    op.drop_index("ix_task_items_task_id", table_name="task_items")
    op.drop_table("task_items")
    op.drop_table("projects")
    op.execute("DROP TYPE item_status")
    op.execute("DROP TYPE project_status")
