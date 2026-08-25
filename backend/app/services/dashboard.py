"""看板统计（对应老平台 dashboard）"""
from datetime import datetime, timezone
from collections import Counter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.task import Task
from app.models.task_item import TaskItem
from app.schemas.enums import TaskStatus, UserRole


async def get_dashboard(current_user, db: AsyncSession) -> dict:
    is_vendor = current_user.role == UserRole.SUPPLIER

    task_q = select(Task)
    if is_vendor:
        task_q = task_q.where(Task.supplier_id == current_user.supplier_id)
    tasks = (await db.execute(task_q)).scalars().all()

    tasks_by_status = dict(Counter(t.status.value for t in tasks))

    project_count = (await db.execute(select(Project.id))).scalars().all() if not is_vendor else \
        list({t.project_id for t in tasks if t.project_id})
    project_count = len(project_count)

    item_q = select(TaskItem)
    if is_vendor:
        task_ids = {t.id for t in tasks}
        item_q = item_q.where(TaskItem.task_id.in_(task_ids) if task_ids else (TaskItem.id == None))  # noqa: E711
    items = (await db.execute(item_q)).scalars().all()
    items_by_status = dict(Counter(i.status.value for i in items))

    now = datetime.now(timezone.utc)
    overdue = sum(1 for t in tasks if t.deadline
                  and t.status not in (TaskStatus.ACCEPTED, TaskStatus.WAREHOUSED, TaskStatus.REPAIR_REQUIRED)
                  and _parse_deadline(t.deadline) < now)

    recent = sorted(tasks, key=lambda t: t.created_at, reverse=True)[:10]
    return {
        "role_type": current_user.role.value,
        "project_count": project_count,
        "total_tasks": len(tasks),
        "tasks_by_status": tasks_by_status,
        "items_by_status": items_by_status,
        "overdue_tasks": overdue,
        "recent_tasks": [
            {"id": str(t.id), "task_name": t.task_name or t.measurement_area_name,
             "status": t.status.value, "deadline": t.deadline, "supplier_id": t.supplier_id}
            for t in recent
        ],
    }


def _parse_deadline(dl: str):
    try:
        return datetime.strptime(dl, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except Exception:
        return datetime.max.replace(tzinfo=timezone.utc)
