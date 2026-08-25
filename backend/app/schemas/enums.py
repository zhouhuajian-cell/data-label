from enum import Enum


class TaskStatus(str, Enum):
    """任务状态枚举（严格状态机单向流转）"""
    UNASSIGNED = "UNASSIGNED"              # 待派发（老流程：项目任务创建后）
    ANNOTATING = "ANNOTATING"              # 标注中（供应商）
    WAITING_OPTIMIZATION = "WAITING_OPTIMIZATION"
    OPTIMIZING = "OPTIMIZING"
    WAITING_ACCEPTANCE = "WAITING_ACCEPTANCE"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    VENDOR_QA = "VENDOR_QA"                # 供应商质检（老流程：标注完成待内审）
    WAREHOUSED = "WAREHOUSED"
    REPAIR_REQUIRED = "REPAIR_REQUIRED"


class DataType(str, Enum):
    """数据类型（区分建图方）"""
    MAPPING_A = "建图A"
    MAPPING_B = "建图B"
    MAPPING_C = "建图C"


class RoadScene(str, Enum):
    """道路场景"""
    URBAN = "城区"
    HIGHWAY = "高速"
    SUBURBAN = "郊区"
    MIXED = "混合"


class UserRole(str, Enum):
    """用户角色"""
    ADMIN = "ADMIN"          # 泰兴管理员
    SUPPLIER = "SUPPLIER"    # 供应商
    OPTIMIZER = "OPTIMIZER"
    ACCEPTOR = "ACCEPTOR"
    PERCEPTION = "PERCEPTION"


class OperationType(str, Enum):
    """操作类型（状态机动作）"""
    CREATE = "CREATE"
    DISPATCH = "DISPATCH"                  # 派发任务给供应商（老流程）
    COMPLETE_WORK = "COMPLETE_WORK"        # 标注完成（老流程）
    SUBMIT_TO_TAIXING = "SUBMIT_TO_TAIXING"
    START_OPTIMIZATION = "START_OPTIMIZATION"
    SKIP_OPTIMIZATION = "SKIP_OPTIMIZATION"
    COMPLETE_OPTIMIZATION = "COMPLETE_OPTIMIZATION"
    ACCEPT = "ACCEPT"
    REJECT = "REJECT"
    RESUBMIT = "RESUBMIT"
    WAREHOUSE = "WAREHOUSE"
    REQUEST_REPAIR = "REQUEST_REPAIR"
    COMPLETE_REPAIR = "COMPLETE_REPAIR"
    UPDATE_PERCEPTION_USAGE = "UPDATE_PERCEPTION_USAGE"  # 感知更新使用状态（不改变任务状态）


class ProjectStatus(str, Enum):
    """项目状态（老平台逻辑）"""
    ACTIVE = "active"
    DONE = "done"
    ARCHIVED = "archived"


class ItemStatus(str, Enum):
    """任务明细状态（老平台逻辑）"""
    PENDING = "pending"            # 待标注
    ANNOTATING = "annotating"      # 标注中
    ANNOTATED = "annotated"        # 待供应商质检
    VENDOR_PASSED = "vendor_passed"  # 供应商质检通过
    SUBMITTED = "submitted"        # 已提交
    ACCEPTED = "accepted"          # 已验收
    REWORK = "rework"              # 返工
