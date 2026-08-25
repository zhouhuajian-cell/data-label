"""结算服务（老平台逻辑：任务验收后按样本×单价×质量系数自动生成）"""
import random
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.settlement import Settlement
from app.models.task import Task
from app.models.task_item import TaskItem
from app.schemas.enums import ItemStatus


def quality_coefficient(ffr: float) -> float:
    if ffr >= 0.95:
        return 1.0
    if ffr >= 0.90:
        return 0.95
    if ffr >= 0.80:
        return 0.90
    if ffr > 0:
        return 0.60
    return 0.0


async def calc_task_settlement(task: Task, db: AsyncSession) -> dict:
    items = (await db.execute(select(TaskItem).where(TaskItem.task_id == task.id))).scalars().all()
    reviewed = [i for i in items if i.client_reviewed]
    valid = [i for i in items if i.status == ItemStatus.ACCEPTED]
    first_pass = [i for i in reviewed if i.first_pass]

    reviewed_count = len(reviewed)
    first_pass_count = len(first_pass)
    ffr = first_pass_count / reviewed_count if reviewed_count else 0.0
    coef = quality_coefficient(ffr)
    valid_count = len(valid)
    unit_price = float(task.unit_price or 0)
    base_amount = round(unit_price * valid_count, 2)
    amount = 0.0 if coef == 0 else round(base_amount * coef, 2)

    return {
        "supplier_id": task.supplier_id, "unit_price": unit_price,
        "valid_count": valid_count, "reviewed_count": reviewed_count,
        "first_pass_count": first_pass_count, "ffr": round(ffr, 4), "coef": coef,
        "base_amount": base_amount, "amount": amount, "rejected": coef == 0,
    }


async def auto_generate(task: Task, db: AsyncSession) -> Settlement | None:
    """任务验收通过后自动生成结算单（幂等）"""
    exists = (await db.execute(
        select(Settlement.id).where(Settlement.task_id == task.id, Settlement.status != "REJECTED")
    )).scalar_one_or_none()
    if exists:
        return None
    calc = await calc_task_settlement(task, db)
    bill_no = "BILL" + datetime.now().strftime("%Y%m%d") + str(random.randint(0, 9999)).zfill(4)
    s = Settlement(task_id=task.id, bill_no=bill_no, **calc)
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return s
