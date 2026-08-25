export const users = [
  { id: 1, username: 'taixing', password: '123', userName: '泰兴基地', roleType: 1, supplierId: null, disabled: false },
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
