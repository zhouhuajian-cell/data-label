"""结算单表

Revision ID: 004
Revises: 003
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "004"
down_revision = "003"


def upgrade() -> None:
    op.create_table(
        "settlements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("bill_no", sa.String(50), nullable=False, unique=True),
        sa.Column("supplier_id", sa.String(50), nullable=False),
        sa.Column("unit_price", sa.DECIMAL(12, 3), nullable=True),
        sa.Column("valid_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("reviewed_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("first_pass_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("ffr", sa.DECIMAL(8, 4), nullable=False, server_default="0"),
        sa.Column("coef", sa.DECIMAL(8, 4), nullable=False, server_default="0"),
        sa.Column("base_amount", sa.DECIMAL(12, 2), nullable=False, server_default="0"),
        sa.Column("amount", sa.DECIMAL(12, 2), nullable=False, server_default="0"),
        sa.Column("rejected", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_settlements_task_id", "settlements", ["task_id"])
    op.create_index("idx_settlement_task", "settlements", ["task_id"])


def downgrade() -> None:
    op.drop_index("idx_settlement_task", table_name="settlements")
    op.drop_index("ix_settlements_task_id", table_name="settlements")
    op.drop_table("settlements")
