export const users = [
  { id: 1, username: 'admin', password: '123', userName: '甲方PM', roleType: 1, supplierId: null, disabled: false },
  { id: 2, username: 'qa_01', password: '123', userName: '甲方质检员', roleType: 2, supplierId: null, disabled: false },
  { id: 3, username: 'supp_a', password: '123', userName: '供应商A-TL', roleType: 3, supplierId: 101, disabled: false },
  { id: 4, username: 'supp_b', password: '123', userName: '供应商B-TL', roleType: 3, supplierId: 102, disabled: false },
  { id: 5, username: 'anno_a1', password: '123', userName: '标注员A1', roleType: 4, supplierId: 101, disabled: false },
  { id: 6, username: 'vqa_a', password: '123', userName: '供应商质检A', roleType: 5, supplierId: 101, disabled: false },
  { id: 7, username: 'algo_01', password: '123', userName: '算法工程师', roleType: 6, supplierId: null, disabled: false },
  { id: 8, username: 'anno_a2', password: '123', userName: '标注员A2', roleType: 4, supplierId: 101, disabled: false },
  { id: 9, username: 'anno_b1', password: '123', userName: '标注员B1', roleType: 4, supplierId: 102, disabled: false },
  { id: 10, username: 'vqa_b', password: '123', userName: '供应商质检B', roleType: 5, supplierId: 102, disabled: false },
  { id: 11, username: 'clean_a1', password: '123', userName: '数据清洗A1', roleType: 7, supplierId: null, disabled: false },
  { id: 12, username: 'clean_b1', password: '123', userName: '数据清洗B1', roleType: 7, supplierId: null, disabled: false }
]

export const suppliers = [
  { id: 101, name: '供应商A', contact: '张经理', capacity: 12000, qualityScore: 92, activeTaskCount: 2 },
  { id: 102, name: '供应商B', contact: '李经理', capacity: 8000, qualityScore: 88, activeTaskCount: 1 }
]

export const tasks = [
  {
    id: 1, taskName: 'A01-城市道路点云标注', nanoId: 'ND001', annotateType: '3D点云标注',
    state: 'ANNOTATING', deadline: '2026-07-25 18:00',
    sampleCount: 10000, unitPrice: 0.15, totalPrice: 1500,
    supplierId: 101, supplierName: '供应商A', currentRework: 0,
    qaStandard: '<p>1. 车辆3D框贴合点云轮廓，误差≤5cm。</p><p>2. 遮挡超50%障碍物不标注。</p>',
    ownerId: 1, projectId: 1,
    submitTime: null, acceptTime: null, rejectCount: 0
  },
  {
    id: 2, taskName: 'A02-行人2D框标注', nanoId: 'ND002', annotateType: '2D拉框',
    state: 'VENDOR_QA', deadline: '2026-07-22 18:00',
    sampleCount: 5000, unitPrice: 0.08, totalPrice: 400,
    supplierId: 101, supplierName: '供应商A', currentRework: 1,
    qaStandard: '<p>1. 标注框完整覆盖可见行人区域。</p><p>2. 漏标率≤0.5%。</p>',
    ownerId: 1, projectId: 1,
    submitTime: null, acceptTime: null, rejectCount: 0
  },
  {
    id: 3, taskName: 'A03-语义分割道路场景', nanoId: 'ND003', annotateType: '语义分割',
    state: 'CLIENT_QA', deadline: '2026-07-20 18:00',
    sampleCount: 3000, unitPrice: 0.25, totalPrice: 750,
    supplierId: 102, supplierName: '供应商B', currentRework: 0,
    qaStandard: '<p>1. 类别边界贴合主体轮廓。</p><p>2. 所有类别按字典输出。</p>',
    ownerId: 1, projectId: 2,
    submitTime: '2026-07-20 09:30', acceptTime: null, rejectCount: 0
  },
  {
    id: 4, taskName: 'A04-车道线质检样本', nanoId: 'ND004', annotateType: '车道线标注',
    state: 'UNASSIGNED', deadline: '2026-07-30 18:00',
    sampleCount: 1200, unitPrice: 0.12, totalPrice: 144,
    supplierId: null, supplierName: '', currentRework: 0,
    qaStandard: '<p>标注实线/虚线/停止线，输出统一JSON。</p>',
    ownerId: 1, projectId: 1,
    submitTime: null, acceptTime: null, rejectCount: 0
  },
  {
    id: 5, taskName: 'A05-行人检测2D框', nanoId: 'ND005', annotateType: '2D拉框',
    state: 'ACCEPTED', deadline: '2026-07-19 18:00',
    sampleCount: 1800, unitPrice: 0.1, totalPrice: 180,
    supplierId: 101, supplierName: '供应商A', currentRework: 0,
    qaStandard: '<p>接单后按时提交压缩包和说明。</p>',
    ownerId: 1, projectId: 2,
    submitTime: '2026-07-18 16:00', acceptTime: '2026-07-19 10:00', rejectCount: 0
  },
  {
    id: 6, taskName: 'A06-隧道场景点云', nanoId: 'ND006', annotateType: '3D点云标注',
    state: 'REJECTED', deadline: '2026-07-21 18:00',
    sampleCount: 800, unitPrice: 0.2, totalPrice: 160,
    supplierId: 102, supplierName: '供应商B', currentRework: 1,
    qaStandard: '<p>隧道场景特殊标注规范。</p>',
    ownerId: 1, projectId: 2,
    submitTime: '2026-07-20 14:00', acceptTime: null, rejectCount: 1
  },
  {
    id: 7, taskName: 'A07-路口全景标注(超时)', nanoId: 'ND007', annotateType: '语义分割',
    state: 'ANNOTATING', deadline: '2026-07-15 18:00',
    sampleCount: 2000, unitPrice: 0.3, totalPrice: 600,
    supplierId: 101, supplierName: '供应商A', currentRework: 0,
    qaStandard: '<p>路口全景标注规范。</p>',
    ownerId: 1, projectId: 1,
    submitTime: null, acceptTime: null, rejectCount: 0
  }
]

export const taskLogs = [
  { taskId: 1, time: '2026-07-15 10:00', content: '甲方创建任务', type: 'primary' },
  { taskId: 1, time: '2026-07-15 14:30', content: '派单给供应商A', type: 'primary' },
  { taskId: 1, time: '2026-07-15 15:00', content: '供应商A接单，开始作业', type: 'success' },
  { taskId: 2, time: '2026-07-18 16:20', content: '供应商A完成作业，内部质检通过', type: 'primary' },
  { taskId: 3, time: '2026-07-20 09:30', content: '供应商B提交交付，等待甲方验收', type: 'warning' },
  { taskId: 5, time: '2026-07-19 10:00', content: '甲方验收通过，得分92', type: 'success' },
  { taskId: 6, time: '2026-07-20 14:00', content: '供应商B提交交付', type: 'primary' },
  { taskId: 6, time: '2026-07-20 16:00', content: '甲方驳回整改：标注错误超标，请修正', type: 'danger' },
  { taskId: 7, time: '2026-07-16 00:00', content: '任务已逾期，超出交付截止时间', type: 'danger' }
]

export const submissions = [
  { id: 1, taskId: 3, version: 'v1.0', submitTime: '2026-07-20 09:30', submitUser: '供应商B',
    score: null, pass: null, result: null, qaReport: false,
    fileName: 'a03-v1.zip', submitDesc: '已完成语义分割标注，自检通过率96%',
    attachments: [] },
  { id: 2, taskId: 5, version: 'v1.0', submitTime: '2026-07-18 16:00', submitUser: '供应商A',
    score: 92, pass: true, result: '验收通过', qaReport: true,
    fileName: 'a05-v1.zip', submitDesc: '行人检测标注完成，质检报告已附',
    attachments: [], reviewComment: '质量优秀，标注准确率高' },
  { id: 3, taskId: 6, version: 'v1.0', submitTime: '2026-07-20 14:00', submitUser: '供应商B',
    score: 65, pass: false, result: '驳回整改', qaReport: true,
    fileName: 'a06-v1.zip', submitDesc: '隧道场景标注',
    attachments: [], reviewComment: '标注错误超标，隧道口漏标严重', rejectReason: '标注错误超标' }
]

export const auditLogs = []

export const taskItems = [
  { id: 101, taskId: 1, itemName: '样本-Batch01-001', dataType: '图像', status: 'annotated', failReason: '', screenshot: null, annotator: '张三' },
  { id: 102, taskId: 1, itemName: '样本-Batch01-002', dataType: '点云', status: 'annotated', failReason: '', screenshot: null, annotator: '张三' },
  { id: 103, taskId: 1, itemName: '样本-Batch01-003', dataType: '图像', status: 'pending', failReason: '', screenshot: null, annotator: '' },
  { id: 104, taskId: 1, itemName: '样本-Batch01-004', dataType: '点云', status: 'rejected', failReason: '点云轮廓不贴合', screenshot: null, annotator: '张三' },
  { id: 105, taskId: 1, itemName: '样本-Batch01-005', dataType: '图像', status: 'failed', failReason: '遮挡超50%', screenshot: null, annotator: '张三' },
  { id: 106, taskId: 2, itemName: '样本-Batch02-001', dataType: '图像', status: 'annotated', failReason: '', screenshot: null, annotator: '李四' },
  { id: 107, taskId: 2, itemName: '样本-Batch02-002', dataType: '图像', status: 'pending', failReason: '', screenshot: null, annotator: '' },
  { id: 108, taskId: 2, itemName: '样本-Batch02-003', dataType: '图像', status: 'failed', failReason: '图像模糊', screenshot: null, annotator: '李四' },
  { id: 109, taskId: 3, itemName: '样本-Batch03-001', dataType: '图像', status: 'annotated', failReason: '', screenshot: null, annotator: '王五' },
  { id: 110, taskId: 3, itemName: '样本-Batch03-002', dataType: '点云', status: 'annotated', failReason: '', screenshot: null, annotator: '王五' },
  { id: 111, taskId: 4, itemName: '样本-Batch04-001', dataType: '图像', status: 'pending', failReason: '', screenshot: null, annotator: '' },
  { id: 112, taskId: 4, itemName: '样本-Batch04-002', dataType: '图像', status: 'pending', failReason: '', screenshot: null, annotator: '' },
  { id: 113, taskId: 5, itemName: '样本-Batch05-001', dataType: '图像', status: 'annotated', failReason: '', screenshot: null, annotator: '赵六' },
  { id: 114, taskId: 5, itemName: '样本-Batch05-002', dataType: '点云', status: 'annotated', failReason: '', screenshot: null, annotator: '赵六' },
  { id: 115, taskId: 6, itemName: '样本-Batch06-001', dataType: '点云', status: 'rejected', failReason: '隧道口漏标', screenshot: null, annotator: '王五' },
  { id: 116, taskId: 6, itemName: '样本-Batch06-002', dataType: '图像', status: 'pending', failReason: '', screenshot: null, annotator: '' },
  { id: 117, taskId: 7, itemName: '样本-Batch07-001', dataType: '图像', status: 'pending', failReason: '', screenshot: null, annotator: '' },
  { id: 118, taskId: 7, itemName: '样本-Batch07-002', dataType: '点云', status: 'pending', failReason: '', screenshot: null, annotator: '' }
]

export const projects = [
  { id: 1, name: 'Maxieye-2026Q3-城市道路标注', clientName: '客户A', annotateType: '3D点云标注', sampleCount: 50000, deadline: '2026-09-30', status: 'active', description: '城市道路场景点云标注项目', createdAt: '2026-07-01 09:00', updatedAt: '2026-07-15 14:30' },
  { id: 2, name: 'Maxieye-2026Q3-行人2D框标注', clientName: '客户B', annotateType: '2D拉框', sampleCount: 30000, deadline: '2026-10-15', status: 'active', description: '行人检测2D框标注', createdAt: '2026-07-05 10:00', updatedAt: '2026-07-12 11:00' },
  { id: 3, name: 'Maxieye-2026Q2-语义分割', clientName: '客户A', annotateType: '语义分割', sampleCount: 20000, deadline: '2026-08-30', status: 'completed', description: '已完成的语义分割项目', createdAt: '2026-06-01 08:00', updatedAt: '2026-08-25 16:00' },
  { id: 4, name: 'Maxieye-2026Q4-车道线标注', clientName: '客户C', annotateType: '车道线标注', sampleCount: 40000, deadline: '2026-11-30', status: 'paused', description: '车道线标注项目（暂停中）', createdAt: '2026-07-10 09:00', updatedAt: '2026-07-18 10:00' }
]

export const projectStats = { projectCount: 4 }

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
  { id: 5, label: '特殊场景', tags: ['施工区', '学校区域', '逆光', '积水'] }
]

// 数据治理中心：R&D 导入的原始数据集合（与项目管理分离）
export const governedDatasets = []
export const governedItems = []
