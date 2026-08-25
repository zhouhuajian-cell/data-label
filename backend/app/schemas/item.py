import uuid
from datetime import datetime
from pydantic import BaseModel
from app.schemas.enums import ItemStatus


class ItemImportRequest(BaseModel):
    """批量导入任务明细"""
    rows: list[dict]


class ItemQaRequest(BaseModel):
    """质检结论（供应商/甲方）"""
    passed: bool
    reject_note: str | None = None


class ItemUpdateRequest(BaseModel):
    status: ItemStatus | None = None
    fail_reason: str | None = None


class ItemResponse(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    item_name: str
    data_type: str | None
    status: ItemStatus
    fail_reason: str | None
    screenshot: str | None
    annotator: str | None
    work_seconds: int
    is_rework: bool
    error_types: list | None
    reject_note: str | None
    submit_count: int
    rework_count: int
    client_reviewed: bool
    first_pass: bool | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
