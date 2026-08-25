"""业务异常定义（PRD 3.3）"""
from fastapi import HTTPException, status


class VersionConflictError(HTTPException):
    """乐观锁版本冲突"""
    def __init__(self, current_version: int):
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "VERSION_CONFLICT",
                    "message": "数据已被其他用户修改，请刷新后重试",
                    "current_version": current_version},
        )


class DuplicateSubmitError(HTTPException):
    """防重复提交"""
    def __init__(self):
        super().__init__(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "DUPLICATE_SUBMIT", "message": "请勿重复提交，请稍后再试"},
        )


class InvalidStateTransitionError(HTTPException):
    """非法状态流转"""
    def __init__(self, current_status: str, action: str):
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_STATE_TRANSITION",
                    "message": f"当前状态 [{current_status}] 不允许执行操作 [{action}]",
                    "current_status": current_status},
        )


class MileageDifferenceError(HTTPException):
    """里程差异超阈值但未填说明"""
    def __init__(self, difference_percentage: float, threshold: float):
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "MILEAGE_DIFFERENCE_REQUIRES_EXPLANATION",
                    "message": f"里程差异达 {difference_percentage:.2f}%，超过阈值 {threshold}%，必须填写差异说明",
                    "difference_percentage": round(difference_percentage, 2),
                    "threshold": threshold},
        )
