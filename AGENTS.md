# 智标数据协作平台 - 开发规范

## 技术栈
- 前端：Vue 3 `<script setup>` + Vite + Element Plus + Pinia + Vue Router + ECharts
- 后端：Node ESM（`"type": "module"`），原生 `node:http` 无框架
- 数据：JSON 文件持久化（`server/data/db.json`，经 `store.js` 防抖落盘）

## 分层架构

### 前端（页面 → 组合式/组件 → API）
```
src/
├── api/          # 唯一网络入口：每个后端模块一个文件，页面禁止直接 fetch/request
├── composables/  # 跨页面复用逻辑（useDownload 等）
├── components/   # common（通用组件）、layout（布局）、业务组件按模块分子目录
├── router/       # 路由（meta.roles 控制访问权限）
├── store/        # Pinia（仅 user 状态）
├── utils/        # 常量与纯函数（constants、csv 解析）
└── views/        # 页面：只做数据获取与组装，不直连网络
```

### 后端（路由 → 服务 → 仓库）
```
server/
├── index.js        # 入口：中间件编排 + 静态资源 + 启动（不含业务路由）
├── middlewares.js  # CORS / 安全头 / 限流
├── router/         # 路由表：按模块拆分（auth/project/task/workbench/governance/admin/finance），只做参数解析与响应
├── services/       # 业务服务：校验 + 业务 + 数据操作 + 审计，按领域拆分
├── repositories/   # 数据访问与持久化（data.js 集合 + store.js saveStore）
├── lib/            # 基础设施（http/auth/rate-limiter/time/images/download/bill-flow）
└── data/           # db.json（持久化文件，勿手改；已 gitignore）
```

## 当前业务主线：验收结算确认流

平台当前聚焦「已验收数据」之后的财务确认节点。改动相关代码前先读 README 的
「验收结算确认流」一节。

- 流程：供应商上传已验收数据（Excel/CSV 导入解析）→ 业务工程师(13) → 财务(14) → 负责人(15) → 感知工程师(16)
- 状态机唯一权威在 `server/lib/bill-flow.js`；**禁止提供"任意改 status"的接口**，status 一律由 `currentStage + rejected` 推导
- 账单集合：`bills` / `billItems`（新增集合必须同步加入 `repositories/store.js` 的 `KEYS`，否则不落盘）
- 结算以项目为导向：每张结算确认单必须带 `projectId`；上传/编辑验收数据统一走 `AcceptanceUploadDialog`（项目页内弹窗，无独立上传页）
- 权限：供应商(3)可建/改项目、上传验收数据；纯供应商账号只能访问「项目管理」+「消息中心」（`canAccessBills` 判定）
- 财务核算：`calculateBill` 只允许「待财务确认」阶段 + 财务(14)/甲方PM(1)；**财务节点确认前必须已核算**（否则 422 `FINANCE_CALC_REQUIRED`）；重提或改明细会清空 `bill.finance`
- 前端数据生产域（数据集/任务/标注/质检）由 `src/utils/constants.js` 的 `FEATURES.DATA_MODULE` 一处开关控制，配套 `DATA_MODULE_PATHS` 路由黑名单；项目管理 `/supplier/projects` 不在此列（保留）
- 账号多角色：`roleTypes` 数组为准（`roleType` = `roleTypes[0]`），后端用 `lib/roles.js` 的 `hasRole/hasAnyRole/roleTypesOf` 判定，**不要写 `user.roleType === x`**
- 环节提醒：`createNotification` 统一走 `enqueueFeishu` 串行限速队列（飞书 Webhook 有频率限制），推送结果落 `auditLogs(action=feishu.push)` 供核对
- 改密：本人 `PUT /api/auth/password`；管理员重置 `PUT /api/users/{id}/password`（置 `mustChangePassword`，首登强制改密）
- 账号列表不对外暴露：登录页无演示账号，`/api/auth/demo-accounts` 已下线

## 硬性规范
1. **页面禁止直接 `fetch` / `request('/api/...')`**：一律在 `src/api/` 封装后调用；下载类文件用 `useDownload().downloadFile(urlPath, fileName)`。
2. **API 命名**：统一 `xxxApi` 后缀（如 `createProjectApi`），返回 `payload`（`{ code, message, data }`）。
3. **后端响应**：统一 `ok(res, data, meta)` / `created(res, data)` / `fail(res, ApiError)`，错误码用 `ApiError(status, CODE, message)`，业务错误 4xx/5xx 不要用 200 掩盖。
4. **权限**：路由层 `requireAuth` 之后，服务层内做角色校验（`requireBuyer` 等），供应商/管理员权限勿在前端硬编码角色数字——统一引用 `utils/constants.js` 的 `ROLE_TYPE`。
5. **导入路径**：统一不带 `.js` 后缀（`@/api/tasks` 而非 `@/api/tasks.js`），后端 ESM 相对导入保留 `.js`。
6. **复用优先**：新增「伪随机图」用 `lib/images.js` 的 `makeImage`；新增「CSV 粘贴解析」用 `utils/csv.js`；不要复制粘贴。
7. **新增路由**：后端在对应 `router/` 模块加分支（不要往 index.js 塞）；前端在 `api/` 加封装后再在页面调用。
8. **删除前确认**：删除页面/导出前先 `grep` 确认无引用（本仓库曾出现孤儿页面与死代码）。
9. **敏感信息**：`db.json`、`uploads/`、`.npm-cache/`、`ngrok.exe` 已 gitignore，勿提交。

## 提交约定

- **直接在 `main` 上提交并推送**（个人仓库，不折腾分支/PR）。
- 提交信息用中文：首行写清"做了什么"，正文按模块列要点。
- 提交前 `git status --short` 扫一眼，确认敏感文件没混进去：`.env`、`deploy/seed.json`（账号种子）、`server/data/`（库备份含密码哈希）、`uploads/`（验收附件）、`.npm-cache/`、`.bak/` 都已在 `.gitignore` 里。

## 部署约定（重要）

- 本平台**固定部署在 `10.2.248.6`**（`algo` 账号，密码认证），访问地址 **`http://10.2.248.6/`**（nginx 反代到 3001；`:3001` 直连也可用）。
- 数据挖掘部署在 `10.2.248.34`（`ad_mining.service` / 8009 / SQLite），**两台机器、完全分开**，不要混用目录、账号、数据库或端口。
- 部署命令：`DEPLOY_SSH_PASSWORD=123 npm run deploy`（脚本默认目标已是 `10.2.248.6`）；细节见 `deploy/部署说明.md`。
- 服务器侧：目录 `/opt/data_label`、服务 `data_label.service`（systemd，开机自启）、库 `data_label`（MySQL），自带 Node 运行时在 `/opt/data_label/runtime`，每日备份定时任务 `/etc/cron.d/data-label-backup`。

## 常用命令
```bash
npm run dev        # 前端开发（vite）
npm run dev:api    # 后端 API（node server/index.js）
npm run build      # 前端构建 → dist/
npm run start      # 生产后端（node server/index.js）
```
后端改动需重启服务生效；前端改动 `npm run build` 后刷新（dist 已被 gitignore，部署用构建产物）。
