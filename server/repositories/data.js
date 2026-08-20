export const users = [
  { id: 1, username: 'admin', password: '123', userName: '甲方PM', roleType: 1, supplierId: null, disabled: false },
  { id: 2, username: 'qa_01', password: '123', userName: '甲方质检员', roleType: 2, supplierId: null, disabled: false },
  { id: 3, username: 'supp_a', password: '123', userName: '供应商A_TL', roleType: 3, supplierId: 101, disabled: false },
  { id: 4, username: 'supp_b', password: '123', userName: '供应商B_TL', roleType: 3, supplierId: 102, disabled: false },
  { id: 5, username: 'anno_a1', password: '123', userName: '标注员A1', roleType: 4, supplierId: 101, disabled: false },
  { id: 7, username: 'algo_01', password: '123', userName: '算法工程师', roleType: 6, supplierId: null, disabled: false },
  { id: 8, username: 'anno_a2', password: '123', userName: '标注员A2', roleType: 4, supplierId: 101, disabled: false },
  { id: 9, username: 'anno_b1', password: '123', userName: '标注员B1', roleType: 4, supplierId: 102, disabled: false },
  { id: 11, username: 'clean_a1', password: '123', userName: '数据清洗A1', roleType: 7, supplierId: null, disabled: false },
  { id: 12, username: 'clean_b1', password: '123', userName: '数据清洗B1', roleType: 7, supplierId: null, disabled: false }
]

export const suppliers = [
  { id: 101, name: '供应商A', contact: '张经理', capacity: 12000, qualityScore: 92, activeTaskCount: 2 },
  { id: 102, name: '供应商B', contact: '李经理', capacity: 8000, qualityScore: 88, activeTaskCount: 1 }
]

export const tasks = []

export const taskLogs = []

export const submissions = []

export const auditLogs = []

export const taskItems = []

export const projects = []

export const projectStats = { projectCount: 0 }

// ===== PRD 扩展集合 =====
// 工时分段记录（防挂机引擎累计的有效工时）
export const workSessions = []

// 结算单（阶梯绩效结算引擎产出）
export const settlements = []

// 标注标签字典（按任务配置，PRD 4.1 模板属性）
export const labelDict = ['车辆', '行人', '骑行者', '交通标志', '障碍物']

// 驳回错误分类（PRD 3.2 极速返工流）
export const ERROR_TYPES = [
  { value: 'bbox_inaccurate', label: '标框不准' },
  { value: 'missing_label', label: '漏标' },
  { value: 'wrong_label', label: '标签选择错误' },
  { value: 'missing_attribute', label: '属性遗漏' },
  { value: 'format_error', label: '格式错误' },
  { value: 'other', label: '其他' }
]

// 消息通知（PRD 协同要求：派发/提交/驳回/验收时自动推送通知）
export const notifications = []

// 数据场景标签维度（可自定义，PM 可增删改）
export const scenarioDimensions = [
  { id: 1, label: '光照', tags: ['白天', '夜晚', '黄昏', '黎明'] },
  { id: 2, label: '天气', tags: ['晴天', '雨天', '雪天', '雾天', '阴天'] },
  { id: 3, label: '道路类型', tags: ['高速', '城区', '乡村', '隧道', '停车场'] },
  { id: 4, label: '交通密度', tags: ['通畅', '缓行', '拥堵'] },
  { id: 5, label: '特殊场景', tags: ['施工区', '学校区域', '逆光', '积水'] },
  { id: 6, label: '车型', tags: ['轿车', 'SUV', '卡车', '客车', '其他车型'] }
]

// 数据治理中心：R&D 导入的原始数据集合（与项目管理分离）
export const governedDatasets = []
export const governedItems = []

// 飞书 Webhook 配置（支持多群推送）
export const feishuConfig = { webhooks: [{ name: '测试通知群', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/731cd5f4-3698-410c-aa58-50222462b983' }], enabled: true }

// ===== GND 业务域集合（与 PRD-Domestic 业务完全隔离，见 docs/GND-改造设计.md）=====

// GND 域用户（账号密码登录；飞书 OAuth 二期绑定 open_id）
export const gndUsers = [
  {
    id: 1,
    username: 'gnd_admin',
    password: '02012d9b6c3ab9af01d6b61bd5db354de85ac7546cc3fe91e0d4d2b269e4d749', // sha256('gnd_admin_123')，部署后请通过改密接口修改
    name: 'GND 泰兴管理员',
    roleType: 8,
    supplierId: null,
    status: 'ACTIVE',
    createdAt: '2026-08-18T00:00:00Z'
  }
]

// GND 域供应商名册（泰兴管理员系统内手工维护）
export const gndSuppliers = []

// GND 测区任务（核心实体）
export const gndTasks = []

// GND 供应商交付记录（1:N round，历史不覆盖）
export const gndSubmissions = []

// GND 优化记录（1:N round）
export const gndOptimizations = []

// GND 验收记录（1:N round，历史不覆盖）
export const gndAcceptances = []

// GND 入库判断记录（1:N round）
export const gndWarehouseRecords = []

// GND 感知使用/返修记录（1:1 当前轮）
export const gndPerceptions = []

// GND 状态历史
export const gndStatusHistory = []

// GND 字段修改历史（道路场景/里程/返修原因等）
export const gndFieldHistory = []

// GND 枚举配置（城市/车型/道路场景/数据类型，后台可维护）
export const gndOptions = [
  // 城市（CITY）
  { id: 1, category: 'CITY', code: 'city.hangzhou', label: '杭州', sortOrder: 1, enabled: true },
  { id: 2, category: 'CITY', code: 'city.beijing', label: '北京', sortOrder: 2, enabled: true },
  { id: 3, category: 'CITY', code: 'city.shanghai', label: '上海', sortOrder: 3, enabled: true },
  { id: 4, category: 'CITY', code: 'city.suzhou', label: '苏州', sortOrder: 4, enabled: true },
  { id: 5, category: 'CITY', code: 'city.guangzhou', label: '广州', sortOrder: 5, enabled: true },
  { id: 6, category: 'CITY', code: 'city.shenzhen', label: '深圳', sortOrder: 6, enabled: true },
  { id: 7, category: 'CITY', code: 'city.wuhan', label: '武汉', sortOrder: 7, enabled: true },
  { id: 8, category: 'CITY', code: 'city.chengdu', label: '成都', sortOrder: 8, enabled: true },
  // 车型（VEHICLE_MODEL）
  { id: 9, category: 'VEHICLE_MODEL', code: 'model.m5', label: 'M5', sortOrder: 1, enabled: true },
  { id: 10, category: 'VEHICLE_MODEL', code: 'model.m7', label: 'M7', sortOrder: 2, enabled: true },
  { id: 11, category: 'VEHICLE_MODEL', code: 'model.m9', label: 'M9', sortOrder: 3, enabled: true },
  // 道路场景（ROAD_SCENE）
  { id: 12, category: 'ROAD_SCENE', code: 'scene.urban', label: '城市道路', sortOrder: 1, enabled: true },
  { id: 13, category: 'ROAD_SCENE', code: 'scene.urban_expressway', label: '城市快速路', sortOrder: 2, enabled: true },
  { id: 14, category: 'ROAD_SCENE', code: 'scene.highway', label: '高速', sortOrder: 3, enabled: true },
  { id: 15, category: 'ROAD_SCENE', code: 'scene.national_road', label: '国道', sortOrder: 4, enabled: true },
  { id: 16, category: 'ROAD_SCENE', code: 'scene.rural', label: '乡村道路', sortOrder: 5, enabled: true },
  { id: 17, category: 'ROAD_SCENE', code: 'scene.tunnel', label: '隧道', sortOrder: 6, enabled: true },
  { id: 18, category: 'ROAD_SCENE', code: 'scene.parking', label: '停车场', sortOrder: 7, enabled: true },
  // 数据类型（DATA_TYPE）
  { id: 19, category: 'DATA_TYPE', code: 'data.gnd', label: 'GND 建图数据', sortOrder: 1, enabled: true },
  { id: 20, category: 'DATA_TYPE', code: 'data.other', label: '其他', sortOrder: 2, enabled: true }
]
