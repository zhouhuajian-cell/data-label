import uuid
from datetime import datetime
from pydantic import BaseModel, Field
from app.schemas.enums import ProjectStatus


class ProjectCreateRequest(BaseModel):
    name: str = Field(..., max_length=100)
    client_name: str | None = Field(None, max_length=100)
    annotate_type: str = Field(..., max_length=100)
    sample_count: int = 0
    deadline: str | None = Field(None, max_length=50)
    description: str | None = Field(None, max_length=500)
    template: str | None = Field(None, max_length=100)
    upload_path: str | None = Field(None, max_length=500)
    dataset_id: str | None = Field(None, max_length=100)


class ProjectUpdateRequest(BaseModel):
    name: str | None = Field(None, max_length=100)
    client_name: str | None = Field(None, max_length=100)
    annotate_type: str | None = Field(None, max_length=100)
    sample_count: int | None = None
    deadline: str | None = Field(None, max_length=50)
    description: str | None = Field(None, max_length=500)
    status: ProjectStatus | None = None


class ProjectResponse(BaseModel):
    id: uuid.UUID
    name: str
    client_name: str | None
    annotate_type: str
    sample_count: int
    deadline: str | None
    status: ProjectStatus
    description: str | None
    template: str | None
    upload_path: str | None
    dataset_id: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
