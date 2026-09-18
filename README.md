# Maxieye数据协作平台 (data_label)

面向 AI 数据标注业务的全流程协作平台。当前阶段**聚焦"已验收数据"之后的财务结算确认节点**，以项目为导向：

> 供应商上传已验收数据（支持 Excel/CSV 导入解析）→ **业务工程师确认 → 财务端确认 → 负责人确认 → 感知工程师确认** → 结算单通过

数据生产域（数据集管理 / 任务管理 / 标注工作台 / 质检）暂时隐藏，由 `src/utils/constants.js` 的 `FEATURES.DATA_MODULE` 一处开关控制（默认 `false`）。
原有能力（项目管理、结算对账、质量治理、飞书通知、Excel 报表导出等）完整保留在代码中。

- **前端**:Vue 3 (`<script setup>`) + Vite + Element Plus + Pinia + Vue Router + ECharts
- **后端**:Node.js 20 ESM,原生 `node:http` 无框架
- **持久化**:MySQL(推荐)或本地 JSON 文件(`server/data/db.json`)自动回退
- **部署**:单进程同时托管静态资源与 API,Docker 一键部署

---

## 目录

- [功能总览](#功能总览)
- [验收结算确认流](#验收结算确认流)
- [技术架构](#技术架构)
- [目录结构](#目录结构)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [持久化设计](#持久化设计)
- [API 设计规范](#api-设计规范)
- [前端分层规范](#前端分层规范)
- [构建与部署](#构建与部署)
- [开发规范摘要](#开发规范摘要)

---

## 功能总览

| 模块 | 说明 |
|------|------|
| 登录认证 | JWT 鉴权,Token 有效期默认 8h,基于角色的访问控制(RBAC) |
| **验收结算确认** | **平台主线**:供应商上传已验收数据 → 四级确认 → 结算单(见下节) |
| 项目管理 | 项目创建/编辑/归档；**项目下直接上传·解析验收数据（弹窗内完成）并跟踪该项目结算情况**（结算入口；供应商可建项目、可上传） |
| 数据集管理 | 数据集上传/导入(CSV 粘贴解析)、图片素材管理（随数据生产域隐藏） |
| 任务中心 | 任务创建、分配、状态流转、截止时间管理（随数据生产域隐藏） |
| 工作台 | 供应商标注工作台、打标(tagging)操作、计时统计（随数据生产域隐藏） |
| 质量治理 | 数据治理模块(独立种子数据),质量检查与治理流程 |
| 结算财务 | 供应商结算、对账、Excel 导出（旧版阶梯绩效 FFR 结算随数据生产域隐藏） |
| 管理后台 | 用户管理、系统配置、审计日志 |
| 消息通知 | 站内通知 + 飞书推送;任务截止前 2 天自动提醒 |
| 可视化 | 数据生产域 Dashboard 基于 ECharts 的数据看板（该模块关闭时不显示，见下） |

## 验收结算确认流

> **单页设计**：结算总览（原「仪表盘」）与确认工作台已**合并为一个页面** `/finance/bills`（菜单「验收结算确认」），
> 打开即可一眼看清各账单的结算情况。原 `/dashboard` 在数据生产域关闭时自动跳转到该页，菜单不再单独显示「仪表盘」。

**两个入口，互为闭环**：

| 入口 | 谁用 | 用途 |
|---|---|---|
| 「财务结算」`/finance/settlement` | 财务 / 管理员 | **每一单都汇到这里由财务核算**：基础金额 → 扣款/税率 → 应付金额，核算后原地「确认」流转至负责人 |
| 「项目管理」`/supplier/projects` | 管理员 / 数据清洗 / **供应商** | **以项目为单位**：选中项目 → 顶部「验收数据与结算」卡显示该项目结算单数/确认中金额/已通过金额 → 「上传验收数据」**在页内弹窗完成**（项目固定为当前项目）→ 下方列出该项目全部结算单及结算进度 |
| 「验收结算确认」`/finance/bills` | 管理员 与四级确认人 | **跨项目全局视图**：各环节待办、项目汇总、全部结算单列表，确认人在此处理确认/驳回 |

- 上传/编辑验收数据统一由 `src/components/finance/AcceptanceUploadDialog.vue` 承载（项目页与结算单页共用），**已无独立上传页面**。
- 结算单详情统一由 `src/components/finance/BillDetailDrawer.vue` 承载（含确认链进度、明细表、确认记录、确认/驳回/编辑/重新提交/删除），项目页与结算单页共用 —— **供应商在项目页内即可查看自己单据的完整明细**。
- **纯供应商账号**（只持供应商角色）只能访问「项目管理」与「消息中心」，落地页即项目管理页；不开放「验收结算确认」页（其本项目结算情况在项目页内直接可见）。

`/finance/bills` 页面自上而下：
1. **统计卡片**：待我确认 / 确认中 / 已通过 / 已驳回 —— 每张卡同时给出**单数 + 金额**；
2. **各环节待办**：业务工程师 / 财务 / 负责人 / 感知工程师四个节点各自的**待确认单数与金额**（点击节点即可筛选该环节单据）——钱卡在哪个环节一眼看到；
3. **项目结算汇总**：按项目汇总结算单数、待确认金额、已通过金额（以项目为导向）；
4. **结算单列表**：每行含**结算进度**（4 个节点圆点：✓已确认 / ▶当前待确认 / ✗被驳回 / ·未开始，悬停显示节点名）与**当前环节**，可直接「去确认」；
5. **详情抽屉**：确认链进度条 + 单据信息 + 明细表 + 确认记录时间线 + 确认/驳回/重新提交操作。


### 流程与状态

```
供应商上传已验收数据 ──► 业务工程师确认 ──► 财务核算+确认 ──► 负责人确认 ──► 感知工程师确认 ──► 已通过
   (可导入解析)              (13)          (14, /finance/settlement)   (15)            (16)
                                        │ 任一节点驳回
                                        ▼
                              已驳回 ──► 供应商修正后重新提交（确认链从业务工程师重新开始）
```

状态由 `currentStage + rejected` 推导,服务端为唯一权威（`server/lib/bill-flow.js`）,**不提供"任意改 status"的接口**:

`PENDING_BIZ` → `PENDING_FINANCE` → `PENDING_LEADER` → `PENDING_PERCEPTION` → `APPROVED` / `REJECTED`

### 角色号（`src/utils/constants.js` 的 `ROLE_TYPE`,与后端 `server/lib/bill-flow.js` 一致）

| 编号 | 角色 | 在流程中的职责 |
|---|---|---|
| 3 | 供应商 | 建项目、上传/解析验收数据、提交结算单、被驳回后修正并重新提交（仅能访问项目管理 + 消息中心） |
| 13 | 业务工程师 | 第 1 节点确认（数据核对） |
| 14 | 财务 | 第 2 节点：**逐单核算**（扣款/税率 → 应付金额）+ 确认 |
| 15 | 负责人 | 第 3 节点确认 |
| 16 | 感知工程师 | 第 4 节点确认（末节点通过即整单通过） |
| 1 | 管理员 | 代供应商建单、查看全部、用户管理；**不参与确认** |

演示账号（密码均为 `123`）：`supp_a`（供应商）、`biz_eng`、`finance_01`、`leader_01`、`perception_01`、`taixing`（管理员）。

### 关键业务规则

- **以项目为导向**：每张结算确认单必须归属一个项目（`projectId`）,可按项目筛选、汇总与导出对账。
- **上传入口在项目下**：上传以弹窗形式在项目页内完成，项目上下文由页面传入（结算单页的"编辑"复用同一弹窗）。
- **财务核算（每单必经）**：财务在「财务结算」页逐单核算——`基础金额(数量×单价合计) − 扣款 = 扣款后金额`；`税额 = 扣款后金额 × 税率%`；`应付金额 = 扣款后金额 + 税额`（口径与后端一致，前端实时试算）。
  - **未核算不能过财务节点**：财务节点确认时若未核算返回 422 `FINANCE_CALC_REQUIRED`；详情抽屉里该情形下"确认通过"直接置灰并提示。
  - **核算作废**：单据被驳回后重新提交、或明细被修改时，`finance` 核算记录自动清空（金额可能变化，需财务重算）。
  - 仅财务(14)与管理员(1)可核算；其他角色 403。
- **数据隔离**：供应商只能看到/操作本供应商的单据（越权 403 `SUPPLIER_DATA_FORBIDDEN`）;四级确认人与管理员 可见全部。
- **禁止跳步**：只有当前节点对应的角色可确认;非当前节点确认返回 403。
- **驳回必填原因**：驳回后退回供应商,重新提交时确认链从第 1 节点重新开始,历史确认记录保留不覆盖。
- **不可篡改历史**：已有确认记录的单据不可编辑/删除（409 `BILL_STATE_CONFLICT`）;驳回后可编辑再重新提交。
- **金额口径**：单行金额 = 数量 × 单价;未填单价时回退表格中的金额列,由服务端统一重算。

### 验收数据导入解析

- **Excel/CSV 文件导入**：`POST /api/finance/bills/parse`（base64 上传 → 服务端 `xlsx`/CSV 解析 → 自动识别表头 → 返回预览行,前端可逐格修正后再提交）
- **粘贴导入**：前端 `src/utils/csv.js` 的 `parseAcceptanceLines`（引号感知,自动跳过表头）
- **手工录入**：表格内直接新增行
- 导入列:任务名称 / 数据类型 / 验收日期 / 数量 / 单价 / 金额 / 数据路径 / 备注（页面可下载导入模板）

### 主要接口（前缀 `/api/finance`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/finance/bills/parse` | 上传 Excel/CSV 解析预览（供应商 / 管理员） |
| GET | `/finance/bills` | 列表（`status` / `scope=todo\|done` / `projectId` / `supplierId` / `keyword` / `dateFrom` / `dateTo` + 分页） |
| POST | `/finance/bills` | 创建结算确认单（需 `projectId` + 明细行） |
| GET | `/finance/bills/{id}` | 详情（含明细、确认链进度、当前用户可执行动作 `permissions`） |
| PUT / DELETE | `/finance/bills/{id}` | 供应商修改 / 删除（仅未进入确认流程时） |
| POST | `/finance/bills/{id}/calculate` | 财务核算（扣款/税率 → 应付金额，仅「待财务确认」阶段） |
| POST | `/finance/bills/{id}/confirm` | 当前节点确认通过（财务节点需先核算） |
| POST | `/finance/bills/{id}/reject` | 驳回（原因必填） |
| POST | `/finance/bills/{id}/resubmit` | 驳回后重新提交 |
| GET | `/finance/stats` | 看板统计（含**项目维度**与供应商维度汇总、待我确认数） |
| GET | `/finance/export` | 明细级对账 CSV 导出（按当前筛选条件） |
| GET | `/finance/stages` | 确认链配置（后端权威） |
| GET | `/projects/options` | 结算单项目下拉（对发起方与四级确认人开放） |


### 环节提醒（站内通知 + 飞书）

**每个环节都会推送提醒**，站内通知与飞书 Webhook 同一入口（`createNotification` → `enqueueFeishu`）：

| 触发动作 | 推送对象 | 消息标题 |
|---|---|---|
| 供应商提交结算单 | 当前节点角色（业务工程师） | 【待业务工程师确认】批次名 |
| 业务工程师确认 | 财务 + 回执提交人 | 【待财务确认】/【已通过业务工程师确认】 |
| 财务确认 | 负责人 + 回执提交人 | 【待负责人确认】/【已通过财务端确认】 |
| 负责人确认 | 感知工程师 + 回执提交人 | 【待感知工程师确认】/【已通过负责人确认】 |
| 感知工程师确认（末节点） | 该单所属供应商 + 管理员 + 提交人 | 【已全部确认】/【结算单已完成】 |
| 任一节点驳回 | 该单所属供应商（含驳回原因） | 【结算单被驳回】 |
| 供应商重新提交 | 业务工程师 + 回执提交人 | 【待业务工程师确认】 |

- **推送对象按"账号持有的角色"匹配**（多角色账号命中即推送），正文统一含：结算单号 · 项目 · 批次 · 供应商 · 金额。
- **限速队列**：飞书自定义机器人对同一 Webhook 有频率限制，突发多条会被拒（`too many request`）。所有推送经 `server/services/feishu.js` 的串行队列（间隔 1.2s + 失败退避重试 2 次）发送，避免某个环节的提醒被静默丢弃。
- **投递审计**：每次推送结果落 `auditLogs`（`action=feishu.push`，含 ok / 失败原因），可在「系统日志」按 `feishu.push` 核对是否真的送达。
- Webhook 配置：「用户管理 → 系统日志」同级由管理员在 `GET/POST /api/feishu/webhook` 维护，支持配置多个群。

### 账号体系（多角色 / 鉴权 / 改密）

- **多角色**：账号持 `roleTypes` 数组（`roleType` 为主角色 = `roleTypes[0]`）。菜单、路由 `meta.roles`、结算确认链、通知推送均按"命中任一角色"判定，因此**同一账号可在确认链上依次推进多个节点（环环相扣）**——例如同持业务工程师(13)与财务(14)的账号可连续确认两个节点；确认记录会记下"以哪个角色动作"。
- **数据隔离按"是否含内部角色"判定**：仅持供应商角色(3)的账号只能看到本供应商单据；同时持有内部角色的账号按内部人员放行。
- **改密**：
  - 本人改密 `PUT /api/auth/password`（校验原密码、新密码≥6 位、新旧不同）；
  - 管理员重置 `PUT /api/users/{id}/password`（重置为默认 `123456`，并置 `mustChangePassword`）；
  - 管理员新建账号同样带 `mustChangePassword`：**首次登录强制改密弹窗**，不可关闭，只能改密或退出登录。
- **账号不再对外暴露**：登录页不再列出任何账号（原演示账号下拉、飞书模拟授权码入口已下线），`/api/auth/demo-accounts` 接口已移除；账号由管理员在「用户管理」内创建并分配角色（支持多选）。登录页仅保留账号密码登录。

## 技术架构

```
┌────────────────────────────────────────────────────────┐
│              浏览器 (Vue 3 SPA)                         │
│   views 页面 ──► api/*Api 封装 ──► fetch /api/v1/*      │
└────────────────────────┬───────────────────────────────┘
                         │ HTTP (JSON)
┌────────────────────────▼───────────────────────────────┐
│         Node 原生 http 服务 (server/index.js)           │
│                                                        │
│  中间件层: CORS / 安全头 / 限流 (middlewares.js)          │
│     │                                                  │
│  路由层: router/ (auth·project·task·workbench·          │
│         governance·admin) 参数解析 + 鉴权 requireAuth    │
│     │                                                  │
│  服务层: services/ 业务校验 + 领域逻辑 + 审计             │
│     │                                                  │
│  仓库层: repositories/ data.js 集合 + store.js 落盘      │
│     │                                                  │
│  存储: MySQL (mysql2) ◄──回退──► db.json (防抖写盘)       │
└────────────────────────────────────────────────────────┘
```

**请求生命周期**(`server/index.js`):

1. `serveStatic`:非 `/api` 的 GET 请求由静态服务处理(dist 目录,SPA history 回退到 index.html);
2. `setCors` + `setSecurityHeaders`:跨域与安全响应头;
3. 生成 `x-request-id`(UUID)用于链路追踪;
4. `applyRateLimit`:接口限流;
5. `dispatchApi`:进入路由分发器,未匹配抛 `ApiError(404)`;
6. 统一异常捕获 → 结构化 JSON 错误日志;
7. **每次请求结束后自动 `saveStore()`**(防抖落盘);
8. 启动时 `loadStore()`,空库时注入演示种子数据;注册 SIGTERM/SIGINT 优雅关闭(10s 超时强杀)。

## 目录结构

```
数据协同/
├── index.html                  # Vite 入口 HTML
├── vite.config.js              # 构建配置(@ 别名、代理、手动分包)
├── package.json                # 脚本与依赖 ("type": "module")
├── Dockerfile                  # 多阶段构建(node:20-alpine)
├── .env.example                # 环境变量模板
├── AGENTS.md                   # 开发规范文档
├── docs/                       # 设计文档
│
├── src/                        # ===== 前端 =====
│   ├── main.js                 # 应用入口(Element Plus/Pinia/Router 注册)
│   ├── App.vue
│   ├── api/                    # ★ 唯一网络入口(16 个模块封装,xxxApi 后缀)
│   │   ├── client.js           #    底层 request 封装(payload 解包/错误处理)
│   │   ├── finance.js          #    验收结算确认单(含导入解析/确认链/导出)
│   │   ├── auth.js / projects.js / tasks.js / workbench.js ...
│   ├── router/                 # 路由(meta.roles 控制页面权限 + 数据生产域开关)
│   ├── store/                  # Pinia(仅 user 状态)
│   ├── composables/            # 组合式函数(useDownload 等)
│   ├── components/
│   │   ├── common/             # 通用组件
│   │   └── layout/             # 布局组件
│   ├── views/                  # 页面(只做取数与组装)
│   │   ├── login/  dashboard/  finance/  message/  admin/
│   │   ├── dataset/  supplier/  task/  workbench/   (数据生产域,受 FEATURES.DATA_MODULE 控制)
│   ├── utils/                  # constants.js(ROLE_TYPE/BILL_STAGES/FEATURES)、csv.js 解析
│   └── styles/
│
├── server/                     # ===== 后端 =====
│   ├── index.js                # 入口:中间件编排+静态资源+启动(无业务路由)
│   ├── config.js               # .env 加载 + 配置(JWT/限流体/MySQL)
│   ├── middlewares.js          # CORS / 安全头 / 限流
│   ├── router/                 # 路由表(按模块拆分,只做参数解析与响应)
│   │   └── finance.js          #    验收结算确认路由(/api/finance/*)
│   ├── services/               # 业务服务(auth/projects/tasks/bills/settlement/
│   │                           #   excel/governance/feishu/deadline-reminder...)
│   ├── repositories/           # 数据访问(data.js 集合 + store.js 落盘)
│   ├── lib/                    # 基础设施(http/auth/rate-limiter/time/images/download/bill-flow)
│   └── data/db.json            # 本地持久化文件(gitignore,勿手改)
│
└── uploads/                    # 上传文件存储(gitignore)
```

## 快速开始

### 本地开发

```bash
# 安装依赖(Node 20+)
npm install

# 复制环境变量(可跳过,留空则使用本地 db.json)
cp .env.example .env

# 终端 1:启动后端 API(端口 3001)
npm run dev:api

# 终端 2:启动前端开发服务器(端口 3000,自动开浏览器)
npm run dev
```

开发模式下 Vite 代理:
- `/api/v1` → `http://127.0.0.1:8000`(外部服务预留)
- `/api` → `http://127.0.0.1:3001`(本平台后端)

### 生产运行

```bash
npm run build        # 构建前端 → dist/
npm run start        # 单进程托管 dist 静态资源 + API,监听 3001
```

首次启动若库为空,会自动注入演示种子数据(含治理模块演示数据),方便直接体验完整流程。

## 环境变量

参考 `.env.example`,复制为 `.env` 后重启生效(项目自带极简 `.env` 加载器,已存在的系统环境变量优先):

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DB_HOST` | 空 | MySQL 地址,**留空则回退本地 db.json** |
| `DB_PORT` | 3306 | MySQL 端口 |
| `DB_USER` / `DB_PASSWORD` | 空 | MySQL 凭据 |
| `DB_NAME` | 空 | 库名(如 `data_label`) |
| `API_HOST` | 0.0.0.0 | 监听地址 |
| `API_PORT` | 3001 | 监听端口 |
| `JWT_SECRET` | dev-only-change-me | **生产环境必填**,缺失时拒绝启动 |
| `TOKEN_TTL_SECONDS` | 28800 | JWT 有效期(默认 8 小时) |
| `CORS_ORIGIN` | * | 允许的跨域来源 |
| `MAX_BODY_BYTES` | 50MB | 请求体大小上限 |

## 持久化设计

双模式存储,由 `repositories/store.js` 统一封装:

1. **MySQL 模式**:`.env` 中 `DB_HOST`/`DB_USER`/`DB_NAME` 齐全时启用(mysql2 连接);
2. **JSON 文件模式**:任一缺失时启用,写入 `server/data/db.json`,带**防抖落盘**机制,每次请求结束触发保存。

启动优先级:`loadStore()` 尝试加载持久化数据 → 成功则恢复;失败/为空则执行 `seedDemoData()` 注入演示数据。

> ⚠️ `db.json`、`uploads/` 已 gitignore,严禁手工编辑 db.json 或将其提交入库。

## API 设计规范

- **统一响应格式**:`{ code, message, data }`(payload),成功用 `ok(res, data, meta)` / `created(res, data)`;
- **错误处理**:业务错误一律 `fail(res, ApiError(status, CODE, message))`,4xx/5xx 不用 200 掩盖;
- **鉴权**:路由层经 `requireAuth`,服务层内做角色校验(`requireBuyer` 等),角色常量统一取自前端 `utils/constants.js` 的 `ROLE_TYPE`;
- **路由新增**:只在对应 `router/<module>.js` 加分支,禁止塞进 `index.js`;
- **限流**:基于路径的内存限流器(`lib/rate-limiter`);
- **健康检查**:`GET /api/health`(Docker HEALTHCHECK 使用)。

## 前端分层规范

```
views 页面(只组装) ──► api/*Api(唯一网络入口) ──► client.js(fetch 封装)
```

- 页面**禁止**直接 `fetch` 或拼 `/api/...` 字符串;
- 所有 API 函数以 `xxxApi` 命名(如 `createProjectApi`);
- 下载类文件统一走 `useDownload().downloadFile(urlPath, fileName)`;
- 路由通过 `meta.roles` 声明式控制访问权限;
- 新增「伪随机图」复用 `lib/images.js` 的 `makeImage`,CSV 粘贴解析复用 `utils/csv.js`,不复制粘贴。

## 构建与部署

### 内网服务器（与「数据挖掘」同机）

生产环境跑在 **`10.2.248.6`** 的 `/opt/data_label`，systemd 服务 `data_label.service`，应用端口 `3001`。

- 访问地址：**http://10.2.248.6/**（nginx 反向代理到 3001，地址不带端口）
- 直连端口 `http://10.2.248.6:3001/` 同样可用（CORS 两个来源都放行）

> **部署目标固定在这台机器上**，与数据挖掘（`10.2.248.34`）**分开两台机器，天然隔离**；同一台机上也不再与任何服务共用目录/账号/数据库/端口。

```bash
npm run check:server    # 探测服务器：Node / MySQL / 端口占用（不改动任何东西）
npm run deploy          # 一键部署：单测 → 构建 → 打包 → 备份 → 上传 → 安装 → 重启 → 健康检查
```

脚本细节、手工部署步骤、运维与回滚命令见 [deploy/部署说明.md](./deploy/部署说明.md)。

要点：
- 部署包只含 `dist/ server/ scripts/ deploy/ package*.json`，**不含** `.env`、`node_modules`、`uploads/`、本地备份与 tests；
- 首次部署在服务器本地生成 `.env`（`JWT_SECRET`、数据库密码用 `openssl rand` 生成）并自动建库建账号；
- 账号与供应商名册通过 `deploy/seed.json` 导入，**不会把 `data.js` 里的演示账号带上线**（`npm run seed:export` / `seed:import`）。

### Vite 构建

- `@` 别名指向 `src/`;目标 ES2020;CSS 代码分割;
- 手动分包策略:`element-plus` / `echarts` / `vue-core`(vue+router+pinia)/ 其余 vendor 各自成 chunk,单 chunk 超 500KB 告警。

### Docker

```bash
docker build -t data-label .
docker run --rm -p 3001:3001 \
  -e NODE_ENV=production \
  -e JWT_SECRET=change-me \
  zhiyun-label
```

多阶段构建:第一阶段 `npm ci && npm run build`;第二阶段仅拷贝 `dist/`、`server/`、`package.json`,以非 root 用户 `nodejs` 运行,内置 `/api/health` 健康检查(30s 间隔)。

## 开发规范摘要

详见 [AGENTS.md](./AGENTS.md),核心硬性规则:

1. 网络请求一律经 `src/api/` 封装;
2. 后端错误码用 `ApiError`,不用 200 掩盖失败;
3. 角色数字不在前端硬编码,统一引用 `ROLE_TYPE` 常量;
4. 前端 import 不带 `.js` 后缀,后端 ESM 相对导入保留 `.js`;
5. 删除页面前先 grep 确认无引用;
6. 敏感信息(db.json、uploads/、ngrok.exe 等)勿提交;
7. 后端改动需重启服务,前端改动需重新 `npm run build`。

## 测试

```bash
npm test                      # 全部用例(node --test)
node --test tests/finance-confirm.test.js   # 验收结算确认流
```

`tests/finance-confirm.test.js` 覆盖:四级正向流转、禁止跳步、角色越权、供应商数据隔离、
驳回回流与重新提交、编辑/删除限制、金额计算口径、以项目为导向的校验与汇总、待办统计。

> 注:`tests/gnd-flow.test.js` 与 `docs/GND-改造设计.md` 属于早期 GND 域（泰兴量产数据交互平台）
> 的设计与用例,对应 `server/services/gnd-*.js` 从未实现,该用例当前必然失败,与本期改造无关。
