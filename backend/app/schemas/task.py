import uuid
from datetime import datetime
from pydantic import BaseModel, Field
from app.schemas.enums import TaskStatus, DataType, RoadScene


# ========== 请求模型 ==========

class TaskCreateRequest(BaseModel):
    """泰兴管理员创建任务（源头字段创建后只读）"""
    measurement_area_name: str = Field(..., max_length=200, description="测区名称，全局唯一")
    city: str = Field(..., max_length=100)
    vehicle_model: str = Field(..., max_length=100)
    data_version: str | None = Field(None, max_length=50)
    data_type: DataType
    source_data_path: str = Field(..., description="源数据路径，创建后只读")
    task_index_path: str = Field(..., description="任务索引路径，创建后只读")
    initial_road_scene: RoadScene = Field(..., description="初始道路场景，不可变")
    supplier_id: str = Field(..., max_length=50, description="分配供应商 ID")


class _Versioned(BaseModel):
    version: int = Field(..., ge=1, description="乐观锁版本号，必填")


class TaskSupplierSubmitRequest(_Versioned):
    """供应商提交给泰兴（SUBMIT_TO_TAIXING / RESUBMIT / COMPLETE_REPAIR）"""
    supplier_mileage: float = Field(..., ge=0)
    supplier_road_scene: RoadScene


class TaskOptimizationRequest(_Versioned):
    """优化员：开始/跳过/完成优化"""
    need_optimization: bool | None = None
    optimization_method: str | None = Field(None, max_length=200)


class TaskAcceptanceRequest(_Versioned):
    """验收员：验收通过"""
    acceptance_mileage: float = Field(..., ge=0)
    acceptance_road_scene: RoadScene
    mileage_difference_explanation: str | None = None


class TaskRejectRequest(_Versioned):
    """验收员：驳回"""
    reject_reason: str = Field(..., min_length=5)


class TaskRepairRequest(_Versioned):
    """感知团队：申请返修"""
    repair_reason: str = Field(..., min_length=5)


class TaskWarehouseRequest(_Versioned):
    """泰兴管理员：入库"""
    pass


class TaskPerceptionUsageRequest(_Versioned):
    """感知团队：更新使用状态（不改变任务状态）"""
    perception_usage_status: str = Field(..., min_length=1)


# ========== 响应模型 ==========

class TaskResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID | None = None
    task_name: str | None = None
    nano_id: str | None = None
    annotate_type: str | None = None
    sample_count: int = 0
    unit_price: float | None = None
    total_price: float | None = None
    deadline: str | None = None
    qa_standard: str | None = None
    upload_path: str | None = None
    current_rework: int = 0
    reject_count: int = 0
    qa_sampling_rate: float = 1.0
    submit_time: datetime | None = None
    accept_time: datetime | None = None
    measurement_area_name: str
    city: str
    vehicle_model: str
    data_version: str | None
    data_type: DataType
    source_data_path: str
    task_index_path: str
    initial_road_scene: RoadScene

    supplier_id: str
    supplier_mileage: float | None
    supplier_road_scene: RoadScene | None

    need_optimization: bool | None
    optimization_method: str | None
    acceptance_mileage: float | None
    acceptance_road_scene: RoadScene | None
    perception_usage_status: str | None

    status: TaskStatus
    version: int
    repair_round: int
    reject_reason: str | None
    repair_reason: str | None
    mileage_difference_explanation: str | None

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TaskListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[TaskResponse]


class TaskListRequest(BaseModel):
    """任务列表查询参数"""
    page: int = Field(1, ge=1)
    page_size: int = Field(20, ge=1, le=100)
    status: TaskStatus | None = None
    supplier_id: str | None = None
    city: str | None = None
    data_type: DataType | None = None
    keyword: str | None = Field(None, description="测区名称关键词")
