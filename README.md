#Maxieye数据协作平台 (zhiyun-label)

面向 AI 数据标注业务的全流程协作平台:覆盖 **项目管理 → 数据集管理 → 标注任务分发 → 供应商标注工作台 → 质量治理 → 结算对账** 的完整闭环,内置飞书通知、截止时间提醒、Excel 报表导出等能力。

- **前端**:Vue 3 (`<script setup>`) + Vite + Element Plus + Pinia + Vue Router + ECharts
- **后端**:Node.js 20 ESM,原生 `node:http` 无框架
- **持久化**:MySQL(推荐)或本地 JSON 文件(`server/data/db.json`)自动回退
- **部署**:单进程同时托管静态资源与 API,Docker 一键部署

---

## 目录

- [功能总览](#功能总览)
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
| 项目管理 | 项目创建、成员与角色管理、进度跟踪 |
| 数据集管理 | 数据集上传/导入(CSV 粘贴解析)、图片素材管理 |
| 任务中心 | 任务创建、分配、状态流转、截止时间管理 |
| 工作台 | 供应商标注工作台、打标(tagging)操作、计时统计 |
| 质量治理 | 数据治理模块(独立种子数据),质量检查与治理流程 |
| 结算财务 | 供应商结算、对账、Excel 导出 |
| 管理后台 | 用户管理、系统配置、审计日志 |
| 消息通知 | 站内通知 + 飞书推送;任务截止前 2 天自动提醒 |
| 可视化 | Dashboard 基于 ECharts 的数据看板 |

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
maxieye/
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
│   ├── api/                    # ★ 唯一网络入口(15 个模块封装,xxxApi 后缀)
│   │   ├── client.js           #    底层 request 封装(payload 解包/错误处理)
│   │   ├── auth.js / projects.js / tasks.js / workbench.js ...
│   ├── router/                 # 路由(meta.roles 控制页面权限)
│   ├── store/                  # Pinia(仅 user 状态)
│   ├── composables/            # 组合式函数(useDownload 等)
│   ├── components/
│   │   ├── common/             # 通用组件
│   │   └── layout/             # 布局组件
│   ├── views/                  # 页面(只做取数与组装)
│   │   ├── login/  dashboard/  dataset/  finance/
│   │   ├── message/ supplier/  task/  workbench/  admin/
│   ├── utils/                  # constants.js(ROLE_TYPE 等)、csv.js 解析
│   └── styles/
│
├── server/                     # ===== 后端 =====
│   ├── index.js                # 入口:中间件编排+静态资源+启动(无业务路由)
│   ├── config.js               # .env 加载 + 配置(JWT/限流体/MySQL)
│   ├── middlewares.js          # CORS / 安全头 / 限流
│   ├── router/                 # 路由表(按模块拆分,只做参数解析与响应)
│   ├── services/               # 业务服务(auth/projects/tasks/settlement/
│   │                           #   governance/excel/feishu/deadline-reminder...)
│   ├── repositories/           # 数据访问(data.js 集合 + store.js 落盘)
│   ├── lib/                    # 基础设施(http/auth/rate-limiter/time/images/download)
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
| `DB_NAME` | 空 | 库名(如 `zhiyun_label`) |
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

### Vite 构建

- `@` 别名指向 `src/`;目标 ES2020;CSS 代码分割;
- 手动分包策略:`element-plus` / `echarts` / `vue-core`(vue+router+pinia)/ 其余 vendor 各自成 chunk,单 chunk 超 500KB 告警。

### Docker

```bash
docker build -t zhiyun-label .
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
