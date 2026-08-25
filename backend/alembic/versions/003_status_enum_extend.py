"""扩展 task_status / operation_type 枚举（老流程状态）

Revision ID: 003
Revises: 002
"""
from alembic import op

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PG 16 支持事务内 ADD VALUE IF NOT EXISTS
    op.execute("ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'UNASSIGNED'")
    op.execute("ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'VENDOR_QA'")
    op.execute("ALTER TYPE operation_type ADD VALUE IF NOT EXISTS 'DISPATCH'")
    op.execute("ALTER TYPE operation_type ADD VALUE IF NOT EXISTS 'COMPLETE_WORK'")


def downgrade() -> None:
    # PG 不支持直接删除 enum 值；生产需重建类型。此处不做破坏性操作。
    pass
