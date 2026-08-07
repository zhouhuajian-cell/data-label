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
├── router/         # 路由表：按模块拆分（auth/project/task/workbench/governance/admin），只做参数解析与响应
├── services/       # 业务服务：校验 + 业务 + 数据操作 + 审计，按领域拆分
├── repositories/   # 数据访问与持久化（data.js 集合 + store.js saveStore）
├── lib/            # 基础设施（http/auth/rate-limiter/time/images/download）
└── data/           # db.json（持久化文件，勿手改；已 gitignore）
```

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

## 常用命令
```bash
npm run dev        # 前端开发（vite）
npm run dev:api    # 后端 API（node server/index.js）
npm run build      # 前端构建 → dist/
npm run start      # 生产后端（node server/index.js）
```
后端改动需重启服务生效；前端改动 `npm run build` 后刷新（dist 已被 gitignore，部署用构建产物）。
