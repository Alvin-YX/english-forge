# EnglishForge 英语学习软件

面向小学生的本地部署英语学习系统：多档案（多孩子）账号体系、教材词库与课程块、听写／拼写／跟读练习、语音评分、错题本、打卡与学习报告、家长看板。

设计目标为**私有化部署**——安装在家庭 NAS（飞牛 fnOS）上，局域网直连，可选公网暴露（FN Connect P2P + ICP 备案并行）。不依赖任何 SaaS，账号与学习数据不出内网；只有 AI 解释类能力调用商用大模型 API。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 API | NestJS + TypeScript，Drizzle ORM，better-sqlite3，argon2，zod |
| 前端 | React 18 + Vite 5 + Tailwind CSS v4 + Zustand + React Router |
| 语音 / AI | Python 3.12（`apps/speech`、`apps/ai`，各自独立虚拟环境） |
| 网关 | nginx（静态托管前端 + 反向代理 API） |
| 数据 | PostgreSQL 16（业务）+ SQLite（本地词库） |
| 部署 | Docker Compose / 飞牛 fnOS `.fpk` 应用包 |
| 工程 | pnpm workspace monorepo，Node ≥ 22，pnpm 9.x |

## 仓库结构

```
apps/
  api/        NestJS 后端，12 个业务模块
  web/        React 前端
  speech/     Python 语音：TTS、对齐、练习评分
  ai/         Python AI 适配层（调用商用大模型 API）
  nginx/      网关与静态资源
packages/
  contracts/  跨服务类型与 API 契约
  db/         Drizzle schema、迁移、种子数据
  content/    教材内容与词库模型
  ui/         前端 UI 组件库
  speech-tts/ TTS 客户端封装
scripts/      词库导入、种子数据、依赖重装、FPK 打包等
ops/          运维文档（fnOS 打包规范、版本一致性校验）
config/       飞牛应用资源与权限声明（docker-project）
docs/adr/     架构决策记录
data/         样例词库（sample-ecdict.csv，其余运行时产物已忽略）
docker-compose.yml
```

`apps/api` 的业务模块：`auth`、`user`、`taxonomy`、`content`、`learning`、`errorbook`、`gamification`、`conversation`、`report`、`scheduler`、`media`、`system`。

## 快速开始

```bash
corepack enable
pnpm install
pnpm db:migrate:sqlite     # 初始化本地 SQLite
pnpm import:ecdict         # 导入词库（无自有词库时回退到 data/sample-ecdict.csv）
pnpm dev                   # 并行启动 api(3000) 与 web(5173)
```

前端通过 Vite 代理把 `/api` 转发到 `localhost:3000`。Python 服务需各自建虚拟环境后启动：

```bash
python -m venv apps/speech/.venv && apps/speech/.venv/Scripts/pip install -r apps/speech/requirements.txt
python -m venv apps/ai/.venv      && apps/ai/.venv/Scripts/pip      install -r apps/ai/requirements.txt
```

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 并行启动所有前端 / API 应用 |
| `pnpm build` | 构建所有 apps 与 packages |
| `pnpm verify` | 依赖环检查 → 类型检查 → lint → 测试，全量门禁 |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | 单项校验 |
| `pnpm db:migrate` / `pnpm db:migrate:sqlite` | 数据库迁移（PostgreSQL / SQLite） |
| `pnpm import:ecdict` | 导入 ECDICT 词库 |
| `pnpm import:sentences` | 导入例句 |
| `pnpm seed:textbooks` | 灌入教材与课程块种子数据 |
| `pnpm check:version` | 校验各应用版本号一致性 |
| `pnpm format` / `pnpm format:check` | Prettier 格式化 |

## 测试

共 25 个测试文件：`apps/api` 12 个模块的集成测试（含跨档案数据隔离 `profile-isolation`），`apps/speech` 7 个（含评分公式 golden test），`apps/ai` 6 个。

```bash
pnpm test                       # 全部
pnpm --filter @eng-forge/api test
pytest apps/speech/tests/ -q
```

## 部署

### Docker Compose

```bash
docker compose build
docker compose up -d
```

5 个服务：`nginx`（对外 **10011** → 80）、`api`（3000）、`speech`、`ai`、`postgres`。数据通过命名卷 `pg-data`、`media-data` 持久化。

### 飞牛 fnOS 应用包

```bash
bash scripts/build-fpk.sh --images --tar
```

产出 `dist/fpk/englishforge_v1.0.0.fpk`，在飞牛应用中心的「手动安装」中上传即可。`.fpk` 格式、`cmd/` 生命周期脚本、manifest 字段的完整规范见 `ops/fnos/FPK-SPEC.md`。

> **打包与镜像构建必须在 NAS 上进行**，不要在本机执行 docker 命令。国内网络环境下各 Dockerfile 已配置相应的 apt / pip / apk / npm 镜像源。

## 架构约束（重要）

`packages/contracts` 与 `packages/db` **没有 build 脚本**，其 `exports` / `main` 全部指向 `src/*.ts`——它们是纯 TypeScript 源码包，由 tsx 在运行时转译消费。

因此 `apps/api` **不能**只编译自己再运行 `dist/` 产物：`main.js` import `@eng-forge/contracts` 时 Node 会解析到 `.ts` 源码并直接抛 `ERR_MODULE_NOT_FOUND` 崩溃。容器内必须用 `pnpm exec tsx apps/api/src/main.ts` 运行 TS 源码，与 `dev` / `start` 脚本保持一致。修改任何打包脚本或 Dockerfile 前请先确认这一点。

## 配置

运行时密钥必须 ≥ 32 字符（后端以 zod 强校验，不合规会直接启动失败）：`JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`。FPK 打包脚本会在构建期生成两个互不相同的随机密钥，不要在 compose 中写死占位值。

各服务的环境变量定义见 `apps/api/src/infra/config/env.ts`（含完整 zod schema 与默认值），部署时的取值见 `docker-compose.yml`。飞牛安装向导所需的无密码模板说明见 `ops/fnos/FPK-SPEC.md`。

真实的 `.env`、密钥文件与大文件（媒体目录、模型权重、镜像 tar、`.fpk` 包）均已加入 `.gitignore`，禁止提交。

## 贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。提交信息格式 `type(scope): 中文描述`，例如 `fix(nginx): 剥离 /api 前缀后再转发`。

**工作区注意**：本项目历史上存在过多个分叉副本，只有仓库根下这份是完整的。请勿在其他目录下的同名副本中开发。

## 许可

AGPL-3.0。
