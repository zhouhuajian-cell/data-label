# GND 泰兴量产数据交互平台 —— maxieye 改造设计（DEV-DESIGN V0.1）

> 用途：在现有 zhiyun-label（maxieye 代码库）上改造扩展 GND 测区交付业务的设计文档。
> 上游输入：《GND量产数据交互平台 PRD》V1.0、《可执行开发规格 DEV SPEC》V1.0、maxieye 现有代码审计。
> 状态：评审中（架构 / ER / 状态机 / API / 权限设计已完成；待确认问题见第 6 章）

---

# 0. 决策记录

| 决策项 | 结论 |
|---|---|
| 开发方向 | 直接在 maxieye（zhiyun-label）上**改造扩展**：GND 业务作为独立业务域与现有业务并存 |
| 技术栈 | 沿用 Vue3 + Element Plus + Node ESM 原生 http + 内存数组持久化（db.json / 可选 MySQL 单表 JSON 兜底） |
| 核心原则 | 复用现有横切能力（认证 / RBAC / 数据隔离 / 审计 / 通知 / 文件 / 导入导出 / 前端组件）；GND 业务模型与状态机按 DEV SPEC 新建 |
| GND 账号体系 | 与现有业务域（PRD-Domestic）**完全隔离**：独立 gndUsers / gndSuppliers，旧账号不可操作 GND，GND 账号不可操作旧域 |
| 一人多岗 | 不需要：一人一岗（roleType 单值 8-12），兼任需求通过多账号解决 |
| 感知团队可见范围 | 全部供应商的**已入库（WAREHOUSED）**任务 |
| GND 账号创建 | 飞书扫码自注册（PENDING）→ 泰兴管理员审批（分配角色/供应商）→ ACTIVE |
| 供应商管理边界 | 平台只做泰兴 ↔ 供应商数据交互：不管理供应商内部状态/岗位/流程，供应商侧统一为"供应商(12)"角色 |
| 飞书登录（MVP） | 沿用模拟模式 + 开放注册入口；真实飞书 OAuth 二期接入 |
| 种子账号 / 供应商名册 | 预置 gnd_admin（首登强制改密）；供应商名册泰兴管理员系统内手工维护 |
| 里程差异阈值 | 验收里程 vs 供应商里程差异比例 > 5% 时高亮并要求差异说明（阈值可后台调整） |
| 测区名称唯一性 | 测区名全局唯一（MVP），同测区重产使用新测区名；version 字段保留预留 |
| 任务作废 | 软删除（VOIDED 状态），仅未接收任务可作废；作废后测区名释放可复用 |
| 时区约定 | UTC 存储 + 前端本地时区显示 |
| 里程单位 | km（3 位小数精度） |
| 感知返修撤回 | 停留 REPAIR_REQUIRED，感知团队可撤回（供应商重新提交成果前）；提交后锁定 |
| 入库不合格处理 | 负责人：泰兴管理员（人工处理通过 → WAREHOUSED） |

复用能力清单（来自现有代码审计）：

- 认证：账号密码 + 飞书扫码登录（services/auth.js + services/feishu.js QR session）
- 权限：requireAuth + roleType RBAC + 供应商数据隔离模式（ensureTaskVisible）
- 审计：auditLogs（services/logs.js）
- 通知：站内通知 notifyByRole（services/notifications.js）+ 飞书 webhook 推送
- 文件：上传 / 下载 / 数据包 zip / 截图（uploads/ + lib/download.js + streamDownload）
- 导入导出：CSV 粘贴解析（utils/csv.js）、Excel 解析（services/excel.js）、CSV 下载
- 其他：防挂机工时（services/timing.js）、结算单（services/settlement.js）、限流 / 安全头（middlewares.js）
- 前端：Element Plus 表格 / 弹窗 / 向导 / 批量操作 / ECharts

---

# 1. 技术架构评审（改造版）

## 1.1 总体策略

GND 业务作为**独立业务域 gnd** 新增，与现有 project/task/workbench/governance/admin 业务域并存、互不干扰（数据集合、路由、页面、角色段全部独立）。

代码落位（对齐现有分层规范，遵守 AGENTS.md）：

```
前端
  src/api/gnd.js                    # GND 域唯一网络入口（gndXxxApi 命名）
  src/views/gnd/                    # 页面：list / detail / workbench / dashboard
  src/router/index.js               # 新增 /gnd/* 路由（meta.roles 控制访问）
  src/utils/constants.js            # 扩展 ROLE_TYPE / GND 状态枚举 / 枚举选项

后端
  server/router/gnd.js              # GND 路由（在 router/index.js 分发器注册）
  server/services/gnd-tasks.js      # 测区任务服务（创建/列表/详情/基础字段）
  server/services/gnd-submission.js # 供应商交付服务（接收任务 / 提交成果）
  server/services/gnd-optimization.js
  server/services/gnd-acceptance.js
  server/services/gnd-warehouse.js
  server/services/gnd-perception.js # 感知使用 + 返修
  server/services/gnd-auth.js        # GND 登录 / 飞书自注册 / 审批
  server/services/gnd-users.js       # GND 用户 / 供应商管理
  server/services/gnd-stats.js      # 看板统计 / 里程导出
  server/lib/gnd-state-machine.js   # GND 状态机（纯函数，后端唯一权威）
  server/lib/gnd-options.js         # 枚举配置读取
  server/repositories/data.js       # 新增 GND 集合（见第 2 章）
  server/repositories/store.js      # 新增集合加入 KEYS（硬要求，否则不持久化）
```

## 1.2 存储与并发评估（基于现状）

现状机制：内存数组为唯一数据源，saveStore() 防抖整体落盘（优先 MySQL 单表 JSON，不可用时写 db.json）。

- 并发：Node 单进程内，状态机"校验 → 写入"在同一同步代码块中天然串行，无竞争。首版**单实例部署**即可满足；多实例部署需再评估，列为 OPEN_QUESTIONS。
- 崩溃窗口：防抖落盘周期内进程崩溃会丢最近若干写（现有系统同样风险，接受；建议落盘周期可配置）。
- 万级性能：GND 任务列表沿用现有"内存过滤 + 分页"模式，1~5 万条内存筛选远低于 2s 要求，OK。看板统计用内存聚合，5 万条内满足 5s。
- 无外键：JSON 无 FK，taskId 引用由服务层校验（沿用 ensureTaskVisible 模式）。
- 无事务：状态机多步写入按顺序执行，**先完成全部校验（权限/状态/字段/业务规则）再写入**，写入阶段按"记录 → 状态 → 历史 → 日志 → 通知"固定顺序，避免中间态。

## 1.3 与 DEV SPEC 的取舍（改造后明确不引入）

| DEV SPEC 项 | 改造决定 |
|---|---|
| React / FastAPI / PostgreSQL / Redis / Alembic / Docker Compose | 不引入，沿用 Vue3 + Node + 现有持久化 |
| 严格状态机（后端唯一权威） | 引入，新增 gnd-state-machine.js；GND 域**禁用**"前端传 status 手动改状态"模式（现有 updateTaskState 只服务旧业务域） |
| 事件驱动自动通知 | 复用 notifyByRole，在状态机统一链中调用（通知失败不影响主事务） |
| 数据库事务 / 索引 / migration | 由"先校验后写入 + 固定写入顺序"替代；数据量或并发超限时再评估迁移关系型建模 |

## 1.4 风险清单

1. 防抖落盘崩溃丢写（现有风险，接受）。
2. 单实例部署是并发安全的隐含前提——必须写入部署说明。
3. 新集合若漏加 store.js 的 KEYS 会静默不持久化——开发检查项。
4. 现有 updateTaskState 手动改状态模式若被 GND 误用会绕过状态机——通过"GND 状态字段由专用服务写入、不暴露通用 status 接口"杜绝。
5. 角色扩展会触碰现有硬编码 roleType 判断点（见第 5 章，需全量 grep 排查）。

---

# 2. 数据模型 ER 设计（db.json 新增集合）

> 全部新集合须加入 server/repositories/store.js 的 KEYS 数组。
> 命名沿用现有 camelCase 风格；集合名加 gnd 前缀与旧业务隔离。

## 2.1 集合总览与关系

```
gndTasks（测区任务，核心） 1 ── N gndSubmissions（供应商交付记录，按 round）
         │ 1 ── N gndOptimizations（优化，按 round）
         │ 1 ── N gndAcceptances（验收，按 round，历史不覆盖）
         │ 1 ── N gndWarehouseRecords（入库判断，按 round）
         │ 1 ── 1 gndPerceptions（感知使用/返修，当前轮）
         │ 1 ── N gndStatusHistory（状态历史）
         │ 1 ── N gndFieldHistory（字段修改历史）
gndOptions（枚举配置：城市/车型/道路场景/数据类型）
gndUsers / gndSuppliers（GND 账号域：用户审批、供应商名册，与旧业务 users/suppliers 完全隔离）
```

- 主键：id 自增数字（匹配现有集合风格）；业务唯一键 measurementAreaName 由服务层校验（创建/导入时查重）。
- 多轮记录：round 从 0 递增（每次验收驳回、感知返修后供应商重新提交成果触发 repairRound++，对应记录追加新 round 条目）。**当前轮** = 该 taskId 下 round 最大的一条。
- 1:1 关系（gndPerceptions）首版按"每个任务一份、可覆盖更新 + 变更历史走 gndFieldHistory"实现。

## 2.2 字段定义

### gndTasks（测区任务）

```js
{
  id: 1,                            // 自增主键
  // 基础信息（泰兴管理员创建，创建后受控可改）
  measurementAreaName: 'HA-001',    // 业务唯一键，必填，全局唯一（创建时校验）
  city: 'city.hangzhou',            // 枚举（gndOptions category=CITY）
  vehicleModel: 'model.m5',         // 枚举（VEHICLE_MODEL）
  version: '',                      // 预留，选填
  dataType: 'data.gnd',             // 枚举（DATA_TYPE）
  sourceDataPath: '/data/raw/...',  // 必填，源数据路径
  taskIndexPath: '/data/index/...', // 必填，任务索引路径
  initialRoadScene: 'scene.urban',  // 枚举（ROAD_SCENE），泰兴初填
  // 分配与状态
  supplierId: 101,                  // 供应商 id
  status: 'WAITING_ANNOTATION',    // GND 状态机枚举（见第 3 章），创建后待供应商接收
  repairRound: 0,                   // 返修轮次，每次驳回/感知返修后重新提交成果 +1
  // 流程时间戳（显式存储，便于耗时统计，不从历史推导）
  receivedAt: null,                 // 供应商接收任务时间
  submittedAt: null,                // 供应商最近一次提交成果时间
  optimizationCompletedAt: null,
  acceptedAt: null, warehousedAt: null,
  // 审计
  createdBy: 1, createdAt: '2026-08-18T10:00:00Z', updatedBy: 1, updatedAt: '2026-08-18T10:00:00Z'
}
```

### gndSubmissions（供应商交付记录，1:N round）

```js
{ id: 1, taskId: 1, round: 0,
  supplierMileage: 12.35,           // 供应商填报里程（结算参考值，必填）
  supplierRoadScene: 'scene.expressway', // 供应商确认/修正的道路场景
  remark: '',                       // 交付备注
  submittedAt: '2026-08-19T09:00:00',
  submittedBy: 3 }                  // 提交人（供应商账号）
```
### gndOptimizations（优化，1:N round）

```js
{ id: 1, taskId: 1, round: 0,
  needOptimization: true,           // 是否优化（优化员判断）
  method: 'script_single_package',  // 优化方式，默认脚本单包处理
  completedAt: null, remark: '', operatorId: 9 }
```

### gndAcceptances（验收，1:N round，历史不覆盖）

```js
{ id: 1, taskId: 1, round: 0,
  acceptanceMileage: 12.10,             // 验收里程（最终结算依据，必填）
  acceptanceRoadScene: 'scene.urban',   // 最终道路场景（一般沿用供应商值，可少量修正）
  result: 'PASSED',                     // PASSED / REJECTED
  rejectReason: null,                   // 驳回时必填
  differenceExplanation: null,          // 里程差异超阈值时必填
  differenceRate: 0.0202,               // 计算值：(|验收-供应|)/供应，留审计
  operatedAt: '2026-08-20T14:00:00', operatorId: 10 }
```

### gndWarehouseRecords（入库判断，1:N round）

```js
{ id: 1, taskId: 1, round: 0,
  result: 'QUALIFIED',              // QUALIFIED / UNQUALIFIED
  warehousedAt: '2026-08-21T10:00:00', remark: '', operatorId: 1 }
```

### gndPerceptions（感知使用/返修，1:1 当前轮）

```js
{ id: 1, taskId: 1,
  usageStatus: 'UNUSED',            // UNUSED / IN_USE / USED
  repairRequired: false,            // 是否提交返修申请
  repairReason: null,               // 申请返修时必填
  updatedBy: 11, updatedAt: '...' }
```

### gndStatusHistory（状态历史）

```js
{ id: 1, taskId: 1, fromStatus: 'WAITING_ANNOTATION', toStatus: 'PROCESSING',
  operatorId: 3, operatorRole: 12, round: 0, remark: '', createdAt: '...' }
```

### gndFieldHistory（字段修改历史：道路场景 / 里程 / 基础字段）

```js
{ id: 1, taskId: 1, fieldName: 'initialRoadScene',
  oldValue: 'scene.urban', newValue: 'scene.expressway',
  operatorId: 3, operatorRole: 12, round: 0, createdAt: '...' }
```

> 记录规则：initialRoadScene / supplierRoadScene / acceptanceRoadScene / supplierMileage / acceptanceMileage / repairReason 等关键字段每次变更写一条，禁止覆盖历史。

### gndUsers（GND 域用户，与旧业务 users 完全隔离）

```js
{ id: 1, feishuOpenId: 'ou_xxx',   // 飞书 open_id，唯一；登录身份
  name: '张三', email: '',
  roleType: 8,                     // 8-12（一人一岗）
  supplierId: null,                // 供应商角色（12）审批时必填，关联 gndSuppliers
  status: 'PENDING',               // PENDING / ACTIVE / DISABLED / REJECTED
  createdAt: '...', approvedBy: null, approvedAt: null, updatedAt: '...' }
```

### gndSuppliers（GND 域供应商名册，与旧 suppliers 隔离）

```js
{ id: 1, name: '历帆', code: 'LF', contact: '', status: 'ACTIVE', createdAt: '...' }
```

> 关系：gndTasks.supplierId → gndSuppliers.id；gndUsers.supplierId → gndSuppliers.id。
> 种子账号：预置 1 个泰兴管理员（gnd_admin），用于首个审批。


### gndOptions（枚举配置，后台可维护）

```js
{ id: 1, category: 'ROAD_SCENE', code: 'scene.urban', label: '城市道路', sortOrder: 1, enabled: true }
```

### 枚举建议初始清单（业务方确认后增删）

- CITY 城市：杭州 / 北京 / 上海 / 苏州 / 广州 / 深圳 / 武汉 / 成都
- VEHICLE_MODEL 车型：M5 / M7 / M9
- ROAD_SCENE 道路场景：城市道路 / 城市快速路 / 高速 / 国道 / 乡村道路 / 隧道 / 停车场
- DATA_TYPE 数据类型：GND 建图数据 / 其他

> 以上为建议初始值（占位），以业务方最终确认为准；gndOptions 支持后台增删改。


---

# 3. 状态机设计

## 3.1 状态枚举（供应商交互边界版）

- 拆分 `待优化/待验收` 合并态为 `WAITING_OPTIMIZATION`（待优化判断）与 `WAITING_ACCEPTANCE`（待验收）两个独立状态；
- 保留 `WAREHOUSE_REJECTED`（入库不合格）并**补齐出口**（DEV SPEC 矩阵中它是死终点）。
- 取消快递寄送管理（业务决策）：删除 SHIPPED 状态；物理数据交接线下协调。
- **供应商管理边界（业务决策）**：平台不管理供应商内部的状态/岗位/流程（标注进度、内部质检等），只保留泰兴 ↔ 供应商的交互节点（接收任务、提交成果）。供应商内部如何组织由供应商自行管理。

```js
WAITING_ANNOTATION    待供应商接收（任务创建后进入）
PROCESSING            供应商处理中（接收后进入；平台不跟踪供应商内部状态）
WAITING_OPTIMIZATION  待优化
OPTIMIZING            优化中
WAITING_ACCEPTANCE    待验收
ACCEPTED              验收通过
REJECTED              驳回返修
WAREHOUSED            已入库
WAREHOUSE_REJECTED    入库不合格
REPAIR_REQUIRED       需返修
VOIDED                已作废（软删除）
```

## 3.2 转移矩阵（供应商交互边界版）

| 当前状态 | 操作 | 下一状态 | 操作角色 | 业务规则 |
|---|---|---|---|---|
| WAITING_ANNOTATION | 接收任务 | PROCESSING | 供应商(12) | 记录 receivedAt |
| WAITING_ANNOTATION | 作废任务 | VOIDED | 泰兴管理员 | 软删除，测区名释放可复用 |
| PROCESSING | 提交成果 | WAITING_OPTIMIZATION | 供应商(12) | 里程/道路场景必填，记录 submittedAt |
| WAITING_OPTIMIZATION | 撤回提交 | PROCESSING | 供应商(12) | 优化员未开始优化前（无本轮 optimization 记录） |
| WAITING_OPTIMIZATION | 开始优化 | OPTIMIZING | 优化员 | needOptimization=true |
| WAITING_OPTIMIZATION | 无需优化 | WAITING_ACCEPTANCE | 优化员 | needOptimization=false |
| OPTIMIZING | 优化完成 | WAITING_ACCEPTANCE | 优化员 | completedAt 记录 |
| WAITING_ACCEPTANCE | 验收通过 | ACCEPTED | 验收员 | 验收里程/道路场景必填；差异超阈值需差异说明 |
| WAITING_ACCEPTANCE | 驳回 | REJECTED | 验收员 | rejectReason 必填 |
| REJECTED | 重新提交成果 | WAITING_OPTIMIZATION | 供应商(12) | repairRound+1，保留历史记录 |
| ACCEPTED | 合格入库 | WAREHOUSED | 泰兴管理员 | — |
| ACCEPTED | 撤销验收 | WAITING_ACCEPTANCE | 泰兴管理员 | 仅未入库前，reason 必填 |
| ACCEPTED | 入库不合格 | WAREHOUSE_REJECTED | 泰兴管理员 | 需人工处理 |
| WAREHOUSE_REJECTED | 人工处理合格 | WAREHOUSED | 泰兴管理员 | 补出口（DEV SPEC 缺失） |
| WAREHOUSED | 提交返修 | REPAIR_REQUIRED | 感知团队 | repairReason 必填 |
| REPAIR_REQUIRED | 撤回返修 | WAREHOUSED | 感知团队 | 供应商重新提交成果前可撤回 |
| REPAIR_REQUIRED | 重新提交成果 | WAITING_OPTIMIZATION | 供应商(12) | repairRound+1 |
## 3.3 实现要求

- server/lib/gnd-state-machine.js 导出 TRANSITIONS（上表数据化）与 assertTransition(task, action, user)；状态合法性唯一权威在服务端。
- GND 域**不提供**"任意改 status"接口；每个动作一个业务接口（见第 4 章），统一执行链：

```
权限校验 → 当前状态校验 → 字段校验 → 业务规则校验（差异说明等）
→ 写业务记录（round 递增）→ 更新 status → 写 gndStatusHistory
→ 写 auditLogs → 触发通知（不影响主流程）
```

- 所有状态变更在单一同步代码块内完成（Node 单进程串行，无锁）。
- 测试要求：正常正向流转、非法跳步（如 待寄送→待验收 必须失败）、驳回回流、感知返修、重复提交、并发提交。

---

# 4. API 清单（详细版，可直接开发）

> 统一前缀 `/api/gnd`，路由落位 `server/router/gnd.js`（在 `router/index.js` 分发器注册，鉴权后按业务域匹配）。
> 响应/错误码严格对齐现有 `lib/http.js`：成功 `{ code: 0, message: 'ok'|'created', data, meta? }`，失败 `{ code, message, details? }` + 对应 HTTP 状态码。

## 4.1 通用约定

### 数据范围（后端强制，禁止前端隐藏代替）

| 角色 | 列表/详情数据范围 |
|---|---|
| 泰兴管理员(8) / 优化员(9) / 验收员(10) | 全部任务 |
| 感知团队(11) | 仅 `status=WAREHOUSED`（跨供应商） |
| 供应商(12) | 仅 `task.supplierId === user.supplierId`（越权 403 SUPPLIER_DATA_FORBIDDEN） |

### 分页规范

- Query：`page`（默认 1）、`page_size`（默认 20，最大 100）
- 响应：`ok(res, items, { total, page, pageSize })`

### 时区与单位

- 时间：统一 UTC 存储（ISO 8601），前端按用户本地时区显示。
- 里程：单位 km，供应商里程与验收里程精度 3 位小数。

### GND 错误码总表

| HTTP | code | 说明 |
|---|---|---|
| 400 | INVALID_JSON | 请求 JSON 格式不正确 |
| 401 | UNAUTHORIZED | 未登录 / 登录态失效 / 用户不可用 |
| 401 | INVALID_CREDENTIALS | 账号或密码错误（账号密码登录保留） |
| 403 | FORBIDDEN | 角色无权限 |
| 403 | SUPPLIER_DATA_FORBIDDEN | 跨供应商访问他人任务 |
| 403 | GND_USER_PENDING | 账号待审批，仅可访问 /auth/me |
| 403 | GND_USER_DISABLED | 账号已禁用 / 被拒 |
| 404 | TASK_NOT_FOUND | 任务不存在 |
| 404 | USER_NOT_FOUND | 用户不存在 |
| 409 | MEASUREMENT_AREA_DUPLICATE | 测区名称已存在（全局唯一） |
| 409 | SUPPLIER_DUPLICATE | 供应商名称 / 编码重复 |
| 409 | TASK_STATE_CONFLICT | 状态不满足操作前提（如非 PENDING 不可审批） |
| 409 | TASK_INVALID_STATUS | 当前任务状态不允许该操作（状态机校验失败） |
| 422 | VALIDATION_ERROR | 参数校验失败（details 列出具体字段） |
| 422 | ROAD_SCENE_INVALID | 道路场景不在枚举配置中 |
| 422 | REJECT_REASON_REQUIRED | 驳回返修时驳回原因必填 |
| 422 | REPAIR_REASON_REQUIRED | 提交返修时返修原因必填 |
| 422 | MILEAGE_DIFFERENCE_REQUIRES_EXPLANATION | 验收里程与供应商里程差异超阈值且未填差异说明 |
| 413 | PAYLOAD_TOO_LARGE | 请求体过大 |
| 429 | RATE_LIMITED | 请求过于频繁 |

---

## 4.2 认证与账号

### POST /api/gnd/auth/login — 账号密码登录（公开）

请求：

```json
{ "username": "gnd_admin", "password": "..." }
```

校验：username / password 必填；用户存在且 status=ACTIVE（PENDING → 403 GND_USER_PENDING；DISABLED/REJECTED → 403 GND_USER_DISABLED）。

响应：同 /auth/feishu 登录成功结构（token + userInfo）。

用途：种子账号 gnd_admin 及 MVP 阶段账号密码登录；飞书为二期入口。

错误码：INVALID_CREDENTIALS / GND_USER_PENDING / GND_USER_DISABLED / VALIDATION_ERROR

### POST /api/gnd/auth/feishu — 飞书登录 / 注册申请（公开）


登录（账号已存在且 ACTIVE）请求：

```json
{ "code": "feishu-xxx" }
```

注册申请（账号不存在）请求：

```json
{ "code": "feishu-xxx", "name": "张三" }
```

响应（登录成功）：

```json
{ "code": 0, "message": "ok",
  "data": { "token": "jwt...", "expiresIn": 7200,
    "userInfo": { "id": 3, "name": "张三", "roleType": 12, "supplierId": 101, "status": "ACTIVE" } } }
```

响应（注册申请已提交）：

```json
{ "code": 0, "message": "ok",
  "data": { "registered": true, "status": "PENDING", "message": "注册申请已提交，等待管理员审批" } }
```

校验与行为：

- `code` 必填；MVP 模拟模式：code 即飞书账号标识（扩展现有 feishuMap 思路），真实 OAuth 二期。
- 账号存在：ACTIVE → 登录成功；PENDING → 403 GND_USER_PENDING；DISABLED/REJECTED → 403 GND_USER_DISABLED。
- 账号不存在：`name` 必填，创建 gndUsers（status=PENDING，roleType/supplierId 待审批分配），返回注册申请响应。

错误码：VALIDATION_ERROR / GND_USER_PENDING / GND_USER_DISABLED / UNAUTHORIZED

### GET /api/gnd/auth/me — 当前用户信息（登录用户）

响应：

```json
{ "code": 0, "message": "ok",
  "data": { "id": 3, "feishuOpenId": "ou_xxx", "name": "张三", "email": "",
            "roleType": 12, "supplierId": 101, "status": "ACTIVE" } }
```

- PENDING 用户也可调用本接口（仅此一个业务接口放行）。

错误码：UNAUTHORIZED

### GET /api/gnd/users — 用户列表 / 审批队列（泰兴管理员 8）

Query：`status`（PENDING/ACTIVE/DISABLED/REJECTED，不传返回全部）、`keyword`（姓名模糊）、`page`、`page_size`

响应：`ok(res, items, { total, page, pageSize })`，items 为 gndUsers 列表（不含敏感字段）。

错误码：FORBIDDEN

### PUT /api/gnd/users/{id}/approve — 审批通过（泰兴管理员 8）

请求：

```json
{ "roleType": 12, "supplierId": 101 }
```

校验：

- 目标用户存在且 status === 'PENDING'（否则 409 TASK_STATE_CONFLICT）。
- roleType ∈ [8, 12]；供应商角色（12）时 supplierId 必填且存在于 gndSuppliers。

响应：`ok(res, user)`，status → ACTIVE，记录 approvedBy/approvedAt。

错误码：FORBIDDEN / USER_NOT_FOUND / TASK_STATE_CONFLICT / VALIDATION_ERROR

### PUT /api/gnd/users/{id}/reject — 拒绝注册（泰兴管理员 8）

校验：目标用户存在且 status === 'PENDING'。

响应：`ok(res, { rejected: true })`，status → REJECTED。

错误码：FORBIDDEN / USER_NOT_FOUND / TASK_STATE_CONFLICT

### PUT /api/gnd/users/{id}/disable — 禁用 / 恢复（泰兴管理员 8）

请求：

```json
{ "status": "DISABLED" }
```

status ∈ [ACTIVE, DISABLED]。

校验：不允许操作自身账号；种子账号 gnd_admin 不可禁用。

响应：`ok(res, user)`。

错误码：FORBIDDEN / USER_NOT_FOUND / VALIDATION_ERROR

### GET /api/gnd/suppliers — 供应商名册查询（登录可见）

Query：`keyword`、`status`（ACTIVE/DISABLED）

响应：`ok(res, items)`。

错误码：UNAUTHORIZED

### POST /api/gnd/suppliers — 新增供应商（泰兴管理员 8）

请求：

```json
{ "name": "历帆", "code": "LF", "contact": "" }
```

校验：name 必填且唯一（409 SUPPLIER_DUPLICATE）；code 唯一（可空）。

响应：`created(res, supplier)`。

错误码：FORBIDDEN / VALIDATION_ERROR / SUPPLIER_DUPLICATE

---

## 4.3 测区任务

### POST /api/gnd/tasks — 创建测区任务（泰兴管理员 8）

请求：

```json
{
  "measurementAreaName": "HA-001",
  "city": "city.hangzhou",
  "vehicleModel": "model.m5",
  "version": "",
  "dataType": "data.gnd",
  "sourceDataPath": "/data/raw/HA-001",
  "taskIndexPath": "/data/index/HA-001",
  "initialRoadScene": "scene.urban",
  "supplierId": 101
}
```

校验：

- measurementAreaName 必填、全局唯一（排除已作废 VOIDED 任务，409 MEASUREMENT_AREA_DUPLICATE），创建后不可修改。
- city / vehicleModel / dataType / initialRoadScene 必填，code 必须存在于 gndOptions 对应分类（422 VALIDATION_ERROR / ROAD_SCENE_INVALID）。
- sourceDataPath / taskIndexPath 必填（格式不做强校验，业务确认后放宽；建议使用绝对路径）。
- supplierId 必填且存在于 gndSuppliers。

响应：`created(res, task)`，初始 status = WAITING_ANNOTATION，repairRound = 0。

错误码：FORBIDDEN / VALIDATION_ERROR / MEASUREMENT_AREA_DUPLICATE / ROAD_SCENE_INVALID

### GET /api/gnd/tasks — 任务列表（8-12，按数据范围）

Query：`page`、`page_size`、`keyword`（测区名称模糊）、`status`、`city`、`supplier_id`、`data_type`、`road_scene`、`created_from`、`created_to`

响应：`ok(res, items, { total, page, pageSize })`，列表项含：id、measurementAreaName、city、vehicleModel、supplierId、status、repairRound、供应商里程（当前轮）、验收里程（当前轮）、道路场景（验收值）、updatedAt。
- VOIDED 任务默认不显示，可通过 status=VOIDED 查询（保留可审计）。

数据范围：供应商(12) 强制追加 supplier_id = user.supplierId；感知(11) 强制 status = WAREHOUSED。road_scene 筛选口径：匹配当前道路场景（优先级 验收值 → 供应商值 → 初填）。

错误码：UNAUTHORIZED / FORBIDDEN

### GET /api/gnd/tasks/{id} — 任务详情（8-12，按数据范围）

响应（聚合详情）：

```json
{ "code": 0, "message": "ok",
  "data": {
    "id": 1, "measurementAreaName": "HA-001", "city": "city.hangzhou",
    "vehicleModel": "model.m5", "version": "", "dataType": "data.gnd",
    "sourceDataPath": "/data/raw/HA-001", "taskIndexPath": "/data/index/HA-001",
    "initialRoadScene": "scene.urban",
    "supplierId": 101, "supplierName": "历帆",
    "status": "WAITING_ANNOTATION", "repairRound": 0,
    "receivedAt": null, "submittedAt": null,
    "optimizationCompletedAt": null,
    "acceptedAt": null, "warehousedAt": null,
    "submissions": [ { "round": 0, "supplierMileage": 12.35, "supplierRoadScene": "scene.expressway", "remark": "", "submittedAt": "...", "submittedBy": 3 } ],
    "optimizations": [ { "round": 0, "needOptimization": true, "method": "script_single_package", "completedAt": null, "remark": "", "operatorId": 9 } ],
    "acceptances":   [ { "round": 0, "acceptanceMileage": 12.10, "acceptanceRoadScene": "scene.urban", "result": "PASSED", "rejectReason": null, "differenceExplanation": null, "differenceRate": 0.0202, "operatedAt": "...", "operatorId": 10 } ],
    "warehouses":    [ { "round": 0, "result": "QUALIFIED", "warehousedAt": "...", "remark": "", "operatorId": 1 } ],
    "perception":    { "usageStatus": "UNUSED", "repairRequired": false, "repairReason": null },
    "statusHistory": [ { "fromStatus": "WAITING_ANNOTATION", "toStatus": "PROCESSING", "operatorId": 3, "round": 0, "createdAt": "..." } ],
    "fieldHistory":  [ { "fieldName": "supplierRoadScene", "oldValue": "scene.urban", "newValue": "scene.expressway", "operatorId": 3, "round": 0, "createdAt": "..." } ]
  } }
```

- 多轮记录（submissions/optimizations/acceptances/warehouses）按 round 升序返回全部，不覆盖历史。
- 供应商(12) 仅能访问本 supplierId 任务；感知(11) 仅已入库任务。

错误码：TASK_NOT_FOUND / SUPPLIER_DATA_FORBIDDEN / FORBIDDEN

### PUT /api/gnd/tasks/{id} — 修改基础字段（泰兴管理员 8）

请求（部分字段，可空）：

```json
{ "city": "city.beijing", "vehicleModel": "model.m7", "version": "v2",
  "dataType": "data.gnd", "sourceDataPath": "/data/raw/HA-001",
  "taskIndexPath": "/data/index/HA-001", "supplierId": 102 }
```

校验：

- 仅 status === 'WAITING_ANNOTATION' 且 receivedAt === null 时可修改（否则 409 TASK_STATE_CONFLICT）。
- measurementAreaName 创建后不可修改；枚举字段校验同创建。

响应：`ok(res, task)`，变更字段写 gndFieldHistory + auditLogs。

错误码：FORBIDDEN / TASK_NOT_FOUND / TASK_STATE_CONFLICT / VALIDATION_ERROR

---

## 4.4 状态流转接口

> 所有流转接口统一执行链：权限校验 → 数据范围校验 → 当前状态校验 → 字段校验 → 业务规则校验 → 写记录（round 递增）→ 更新 status → 写 gndStatusHistory → 写 auditLogs → 通知（不影响主事务）。
> 前端不得直接修改 task.status；GND 域不暴露通用 status 修改接口。
> 供应商侧仅保留两个交互节点：接收任务、提交成果；供应商内部流程平台不管理。

### POST /api/gnd/tasks/{id}/receive — 接收任务（供应商 12）

请求：`{}`（无参数）

校验：status === 'WAITING_ANNOTATION'；任务属于当前用户供应商。

行为：status → PROCESSING，记录 receivedAt。

响应：`ok(res, task)`。

错误码：TASK_NOT_FOUND / SUPPLIER_DATA_FORBIDDEN / TASK_INVALID_STATUS

### POST /api/gnd/tasks/{id}/submit — 提交成果（供应商 12）

请求：

```json
{ "supplierMileage": 12.35, "supplierRoadScene": "scene.expressway", "remark": "" }
```

校验：

- status ∈ [PROCESSING, REJECTED, REPAIR_REQUIRED]（初始交付 / 验收驳回后重新交付 / 感知返修后重新交付）。
- supplierMileage > 0；supplierRoadScene 必填且合法枚举（ROAD_SCENE_INVALID）。

行为（写当前轮 gndSubmissions 记录）：

- 从 REJECTED / REPAIR_REQUIRED 提交时 repairRound + 1。
- status → WAITING_OPTIMIZATION，记录 submittedAt。

响应：`ok(res, task)`。

错误码：TASK_NOT_FOUND / SUPPLIER_DATA_FORBIDDEN / TASK_INVALID_STATUS / VALIDATION_ERROR / ROAD_SCENE_INVALID

### POST /api/gnd/tasks/{id}/submit/cancel — 撤回提交成果（供应商 12）

请求：`{}`

校验：status === 'WAITING_OPTIMIZATION'；优化员未开始优化（无本轮 optimization 记录）；任务属于当前用户供应商。

行为：status → PROCESSING，保留本轮 submission 记录（供追溯），写 gndStatusHistory + auditLogs。

响应：`ok(res, task)`。

错误码：TASK_NOT_FOUND / SUPPLIER_DATA_FORBIDDEN / TASK_INVALID_STATUS

### POST /api/gnd/tasks/{id}/acceptance/revert — 撤销验收（泰兴管理员 8）

请求：

```json
{ "reason": "验收操作有误" }
```

校验：status === 'ACCEPTED' 且未入库（无本轮 warehouse 记录）；reason 必填。

行为：status → WAITING_ACCEPTANCE，保留本轮验收记录（供追溯），写 gndStatusHistory + auditLogs。

响应：`ok(res, task)`。

错误码：FORBIDDEN / TASK_NOT_FOUND / TASK_INVALID_STATUS / VALIDATION_ERROR

### POST /api/gnd/tasks/{id}/optimization/start — 开始优化（优化员 9）


请求：

```json
{ "method": "script_single_package", "remark": "" }
```

校验：status === 'WAITING_OPTIMIZATION'；method 缺省为 script_single_package。

行为：status → OPTIMIZING，写 optimization 记录（needOptimization=true）。

响应：`ok(res, task)`。

错误码：FORBIDDEN / TASK_NOT_FOUND / TASK_INVALID_STATUS

### POST /api/gnd/tasks/{id}/optimization/skip — 无需优化（优化员 9）

请求：

```json
{ "remark": "" }
```

校验：status === 'WAITING_OPTIMIZATION'。

行为：status → WAITING_ACCEPTANCE，写 optimization 记录（needOptimization=false），记录 optimizationCompletedAt。

响应：`ok(res, task)`。

错误码：FORBIDDEN / TASK_NOT_FOUND / TASK_INVALID_STATUS

### POST /api/gnd/tasks/{id}/optimization/complete — 优化完成（优化员 9）

请求：

```json
{ "remark": "" }
```

校验：status === 'OPTIMIZING'。

行为：status → WAITING_ACCEPTANCE，记录 optimizationCompletedAt。

响应：`ok(res, task)`。

错误码：FORBIDDEN / TASK_NOT_FOUND / TASK_INVALID_STATUS

### POST /api/gnd/tasks/{id}/acceptance — 验收（验收员 10）

请求：

```json
{ "acceptanceMileage": 12.10, "acceptanceRoadScene": "scene.urban",
  "result": "PASSED", "rejectReason": null, "differenceExplanation": null }
```

校验：

- status === 'WAITING_ACCEPTANCE'。
- acceptanceMileage > 0；acceptanceRoadScene 必填合法；result ∈ [PASSED, REJECTED]。
- REJECTED：rejectReason 必填（422 REJECT_REASON_REQUIRED）。
- PASSED 且 |acceptanceMileage - supplierMileage| / supplierMileage > 5%（supplierMileage 取当前轮最新 gndSubmissions 值；阈值可经 gndOptions 调整）：differenceExplanation 必填（422 MILEAGE_DIFFERENCE_REQUIRES_EXPLANATION）；differenceRate 计算后存记录。

行为（写当前轮 acceptance 记录，历史不覆盖）：

- PASSED：status → ACCEPTED，记录 acceptedAt。
- REJECTED：status → REJECTED。

响应：`ok(res, task)`。

错误码：FORBIDDEN / TASK_NOT_FOUND / TASK_INVALID_STATUS / VALIDATION_ERROR / REJECT_REASON_REQUIRED / MILEAGE_DIFFERENCE_REQUIRES_EXPLANATION

### POST /api/gnd/tasks/{id}/warehouse — 入库判断（泰兴管理员 8）

请求：

```json
{ "result": "QUALIFIED", "remark": "" }
```

校验：status === 'ACCEPTED'；result ∈ [QUALIFIED, UNQUALIFIED]。

行为（写当前轮 warehouse 记录）：QUALIFIED → status=WAREHOUSED + warehousedAt；UNQUALIFIED → status=WAREHOUSE_REJECTED。

响应：`ok(res, task)`。

错误码：FORBIDDEN / TASK_NOT_FOUND / TASK_INVALID_STATUS / VALIDATION_ERROR

### POST /api/gnd/tasks/{id}/warehouse/recover — 入库不合格人工处理通过（泰兴管理员 8）

请求：

```json
{ "remark": "人工核实数据合格" }
```

校验：status === 'WAREHOUSE_REJECTED'。

行为：status → WAREHOUSED，记录 warehousedAt 与 remark。

响应：`ok(res, task)`。

错误码：FORBIDDEN / TASK_NOT_FOUND / TASK_INVALID_STATUS

### PUT /api/gnd/tasks/{id}/perception — 更新感知使用状态（感知团队 11）

请求：

```json
{ "usageStatus": "IN_USE" }
```

校验：status === 'WAREHOUSED'；usageStatus ∈ [UNUSED, IN_USE, USED]。

行为：更新 gndPerceptions 记录。

响应：`ok(res, perception)`。

错误码：FORBIDDEN / TASK_NOT_FOUND / TASK_INVALID_STATUS / VALIDATION_ERROR

### POST /api/gnd/tasks/{id}/repair — 感知返修申请（感知团队 11）

请求：

```json
{ "repairReason": "道路场景标注与实车不符" }
```

校验：status === 'WAREHOUSED'；repairReason 必填（422 REPAIR_REASON_REQUIRED）。

行为：status → REPAIR_REQUIRED，写 perception 记录（repairRequired=true），通知泰兴管理员与供应商。

响应：`ok(res, task)`。

错误码：FORBIDDEN / TASK_NOT_FOUND / TASK_INVALID_STATUS / REPAIR_REASON_REQUIRED

### POST /api/gnd/tasks/{id}/void — 作废任务（泰兴管理员 8）

请求：

```json
{ "reason": "创建错误" }
```

校验：status === 'WAITING_ANNOTATION'（仅未接收任务可作废）；reason 必填。

行为：status → VOIDED（软删除，**不可恢复**），释放测区名（可被新任务复用），写 gndStatusHistory + auditLogs。

响应：`ok(res, task)`。

错误码：FORBIDDEN / TASK_NOT_FOUND / TASK_INVALID_STATUS / VALIDATION_ERROR

### POST /api/gnd/tasks/{id}/repair/cancel — 撤回返修申请（感知团队 11）

请求：`{}`

校验：status === 'REPAIR_REQUIRED'；供应商未重新提交成果（无新一轮 gndSubmissions 记录）。

行为：status → WAREHOUSED，感知记录 repairRequired=false。

响应：`ok(res, task)`。

错误码：FORBIDDEN / TASK_NOT_FOUND / TASK_INVALID_STATUS

## 4.5 配置与统计

### GET /api/gnd/options — 枚举配置查询（登录可见）

Query：`category`（CITY / VEHICLE_MODEL / DATA_TYPE / ROAD_SCENE，不传返回全部）

响应：`ok(res, items)`，items 为 gndOptions 列表（enabled=true 优先）。

错误码：UNAUTHORIZED

### PUT /api/gnd/options/{category} — 枚举配置维护（泰兴管理员 8）

请求（整体替换该分类下启用的选项）：

```json
{ "items": [ { "code": "scene.urban", "label": "城市道路", "sortOrder": 1, "enabled": true },
             { "code": "scene.expressway", "label": "高速", "sortOrder": 2, "enabled": true } ] }
```

校验：category ∈ 上述 4 类；items 内 code 唯一且非空。

响应：`ok(res, items)`，变更写 auditLogs。

错误码：FORBIDDEN / VALIDATION_ERROR

### GET /api/gnd/stats/overview — 看板统计（泰兴管理员 8）

Query：`city`、`supplier_id`、`data_type`、`date_from`、`date_to`

响应：

```json
{ "code": 0, "message": "ok",
  "data": {
    "total": 100,
    "statusDistribution": { "WAITING_ANNOTATION": 10, "PROCESSING": 20, "WAITING_OPTIMIZATION": 8,
                            "OPTIMIZING": 2, "WAITING_ACCEPTANCE": 7,
                            "ACCEPTED": 3, "REJECTED": 4, "WAREHOUSED": 30, "WAREHOUSE_REJECTED": 1, "REPAIR_REQUIRED": 2, "VOIDED": 5 },
    "avgDurationDays": { "supplier": 1.5, "optimization": 1.0, "acceptance": 1.0, "warehouse": 0.5, "total": 4.5 },
    "reworkRate": { "acceptanceRejectRate": 0.05, "perceptionRepairRate": 0.02 },
    "mileageSummary": { "acceptanceCount": 80, "totalMileage": 950.5, "avgMileage": 11.88 }
  } }
```

- 耗时统计基于 gndTasks 显式时间戳，不依赖历史推导：supplier = receivedAt → submittedAt；optimization = WAITING_OPTIMIZATION → optimizationCompletedAt；acceptance = WAITING_ACCEPTANCE → acceptedAt；warehouse = ACCEPTED → warehousedAt；total = createdAt → warehousedAt。
- 返修率分母定义见 OPEN_QUESTIONS P1-10。

错误码：FORBIDDEN

### GET /api/gnd/stats/export — 里程结算导出（泰兴管理员 8）

Query：`supplier_id`、`city`、`date_from`、`date_to`

响应：CSV 文件下载（Content-Type: text/csv，Content-Disposition: attachment），仅导出有验收记录的已验收/已入库任务。

导出字段：测区名称、城市、车型、数据类型、供应商、供应商里程(km)、验收里程(km)、道路场景（验收值）、验收时间、当前状态。

错误码：FORBIDDEN

# 5. 权限设计（详细版）

## 5.1 决策记录（已与业务确认，2026-08）

| 决策项 | 结论 |
|---|---|
| 账号体系 | GND 域与旧业务（PRD-Domestic）**完全隔离**：独立 gndUsers / gndSuppliers，旧账号不可操作 GND，GND 账号不可操作旧域 |
| 一人多岗 | 不需要：一人一岗（roleType 单值 8-12），兼任需求通过多账号解决 |
| 感知可见范围 | 全部供应商的**已入库（WAREHOUSED）**任务 |
| 账号创建 | 飞书扫码自注册（PENDING）→ 泰兴管理员审批（分配角色/供应商）→ ACTIVE |

## 5.2 角色定义

| 编号 | 角色 | 所属 | 数据范围 | 核心职责 |
|---|---|---|---|---|
| 8 | TAIXING_ADMIN 泰兴管理员 | 泰兴 | 全量 | 创建任务、分配供应商、入库判断、看板/导出/枚举配置、账号审批 |
| 9 | OPTIMIZER 优化员 | 泰兴 | 全量 | pose 优化判断与处理 |
| 10 | ACCEPTOR 验收员 | 泰兴 | 全量 | 验收、里程确认、驳回 |
| 11 | PERCEPTION 感知团队 | 泰兴（使用方） | 仅已入库（跨供应商） | 使用情况、返修申请 |
| 12 | SUPPLIER 供应商交付员 | 供应商 | 仅本 supplierId | 接收任务、提交成果（填里程/道路场景）、驳回/返修后重新交付 |

## 5.3 数据范围（行级，后端强制）

- 泰兴方（8/9/10）：全部 GND 任务。
- 感知团队（11）：仅 status=WAREHOUSED（已入库）任务，**跨供应商可见**（入库即最终成果）。
- 供应商（12）：仅 task.supplierId === user.supplierId，沿用现有 ensureTaskVisible 模式（gndEnsureTaskVisible）。
- PENDING / REJECTED / DISABLED 账号：拒绝一切业务接口。

## 5.4 字段级读写矩阵

| 字段 | 泰兴管理员(8) | 优化员(9) | 验收员(10) | 感知(11) | 供应商(12) |
|---|---|---|---|---|---|
| 基础信息（测区/城市/车型/数据类型/源数据路径/任务索引路径/版本） | 读写 | 只读 | 只读 | 只读 | 只读 |
| 初始道路场景（泰兴初填） | 写（创建） | 只读 | 只读 | 只读 | 只读 |
| 供应商里程 / 供应商道路场景 / 交付备注 | 只读 | 只读 | 只读 | 只读 | **写**（提交成果时） |
| 优化字段（是否优化/方式/备注） | 只读 | **写** | 只读 | 只读 | 只读 |
| 验收里程 / 验收道路场景 / 结论 / 驳回原因 / 差异说明 | 只读 | 只读 | **写** | 只读 | 只读 |
| 入库判断 / 入库备注 | **写** | 只读 | 只读 | 只读 | 只读 |
| 使用情况 / 返修申请 | 只读 | 只读 | 只读 | **写** | 只读 |
| 枚举配置 / 看板 / 里程导出 | **写** | – | – | – | – |

> 规则：道路场景三份值（initial / supplier / acceptance）各自独立存储、各自只可写自己的那份；里程双值（供应商/验收）互不覆盖。字段级控制 = 后端校验 + 前端禁用输入框双层实现。
> 说明：感知团队对已入库任务全部字段只读（含源数据路径/任务索引路径）；如需对使用方脱敏，二期处理。

## 5.5 状态机动作权限

状态转移与操作角色的绑定见第 3 章矩阵；assertTransition 内做**角色 + 数据范围**双重校验。补充明确：

- 接收任务 / 提交成果（含验收驳回后、感知返修后的重新提交）：供应商（12）任一账号，平台不限定供应商内部岗位分工。
- 感知返修申请：感知团队（11）；供应商重新提交成果即视为开始返修。
## 5.6 账号生命周期（飞书自注册 + 审批）

```
飞书扫码登录（GND 域）
  ├─ 账号存在且 ACTIVE   → 正常登录，按 roleType 进入对应工作台
  ├─ 账号存在但 PENDING  → 仅显示"等待管理员审批"页，拒绝业务接口
  ├─ 账号存在但 DISABLED / REJECTED → 拒绝登录并提示
  └─ 无账号 → 自动创建 PENDING（记录飞书 open_id / 姓名）→ 提示等待审批

泰兴管理员审批（/api/gnd/users）：
  同意 → 分配角色（8-12）；供应商角色（12）必须指定 supplierId → ACTIVE
  拒绝 → REJECTED
```

- 首个泰兴管理员：预置种子账号 gnd_admin（初始密码由部署配置，首次登录强制修改），用于首个审批。
- 供应商角色审批时只能关联 gndSuppliers 名册中的供应商。

## 5.7 实现要点

- src/utils/constants.js：ROLE_TYPE / ROLE_LABELS 扩展 GND 段（8-12）。
- server/services/gnd-auth.js：独立登录 + 自注册 + 审批状态查询；JWT 增加 domain:'gnd'（或独立签发逻辑），verifyToken 按域查 gndUsers。
- server/services/gnd-users.js：用户列表 / 审批 / 禁用；供应商名册维护。
- server/services/gnd-tasks.js 内 gndEnsureTaskVisible：供应商角色校验 supplierId；感知角色校验 status=WAREHOUSED。
- 前端路由 meta.roles：GND 页面只对 8-12 开放；旧域路由只对 1-7 开放（双向隔离）。
- 新增角色号 8-12 不会命中旧域 [1,2,7] / [3,4] 等硬编码集合，天然隔离；仍需全量 grep 排查 + 测试确认。
- PENDING 用户 token 可签发，但业务接口一律 403（仅允许 /api/gnd/auth/me）。
- 供应商名册（gndSuppliers）由泰兴管理员在系统内手工维护（新增 / 编辑 / 停用），不依赖旧系统数据。
- 飞书登录 MVP 沿用模拟模式（feishuMap 扩展 + 开放注册入口），真实飞书开放平台 OAuth 二期接入（gndUsers.feishuOpenId 已预留字段）。

## 5.8 权限测试用例

- 供应商 A 账号访问供应商 B 任务 → 403
- 供应商调用验收 / 入库 / 优化接口 → 403
- 验收员修改供应商里程 → 403；供应商修改验收里程 → 403
- 感知团队访问在途任务 → 403；访问已入库任务 → 200
- PENDING 账号访问业务接口 → 403
- 泰兴管理员访问旧域接口（/api/projects 等）→ 403（账号隔离）
- 旧域账号（甲方PM）访问 GND 接口 → 403
- 供应商任一账号可接收任务 / 提交成果（平台不区分供应商内部岗位）

# 6. OPEN_QUESTIONS（待业务确认）

## P0（已全部确认，决策见第 0 章决策记录）

## P1（可后补）

1. 看板"返修率"分母定义（验收驳回率 vs 感知返修率，含多轮）。
2. 里程导出格式（CSV / XLSX）与字段清单确认。
3. 通知触发清单：每个状态变更 → 通知哪些角色（建清单确认）。
4. 飞书通知方式：自建应用 / webhook（现有 feishu webhook 手动推送模式是否够用）。
5. 多实例部署与数据迁移预案（数据量超限时是否迁移 MySQL 关系建模）。

---

# 附：与 DEV SPEC 的对应关系

| DEV SPEC 章节 | 本设计对应 | 差异说明 |
|---|---|---|
| 5 数据库设计（13 表） | 2 数据模型（11 集合） | 表→JSON 集合；多轮记录 1:N 修正；账号域 gndUsers/gndSuppliers |
| 7-9 状态机 | 3 状态机 | 拆分待优化/待验收；补 WAREHOUSE_REJECTED 出口；供应商交互边界（只保留接收/提交成果） |
| 11-21 API | 4 API 清单（详细版） | 前缀 /api/gnd；31 个接口含请求/响应/校验规则/错误码 |
| 10 权限模型 | 5 权限设计 | 角色段 8-12；账号完全隔离 + 飞书自注册审批；字段级读写矩阵 |
| 42 待确认问题 | 6 OPEN_QUESTIONS | 承接并扩展（多轮记录、入库不合格出口等） |
