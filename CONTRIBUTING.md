# EnglishForge · 开发环境与流程约定

> 本文件是项目的工程硬约定，与 03 技术研发方案第 8 章（工程规范）配套。
> 凡与 03 文档冲突之处，均在「文档偏离登记」中显式记录，不允许静默偏离。

---

## 1. 仓库与包管理

| 项 | 值 | 说明 |
|---|---|---|
| 仓库根 | `english-forge/` | pnpm-workspace monorepo |
| 包管理器 | **pnpm 9.15.0** | ⚠️ 不用 pnpm 10（见偏离登记 D-03） |
| Node | **22 LTS**（本机 22.22.2 ✅） | |
| 锁文件 | `pnpm-lock.yaml` | 必须提交，CI 用 `--frozen-lockfile` |

### npm 镜像（🔴 本机必需）

本机 `registry.npmjs.org` 不可达，**必须**使用镜像。项目根 `.npmrc` 已内置：

```
registry=https://registry.npmmirror.com/
```

CI（GitHub Actions）环境可直连官方源，但为一致性同样保留该配置；若需切回官方源，用 `NPM_CONFIG_REGISTRY=` 环境变量覆盖。

---

## 2. Python 环境

| 项 | 值 |
|---|---|
| 版本约束 | `>=3.12,<3.14`（本机 3.13.14 ✅，文档写 3.12） |
| 虚拟环境 | `apps/speech/.venv`、`apps/ai/.venv`（各自独立） |
| 工具链 | `ruff`（lint+format）、`mypy --strict`、`pytest` |
| 禁止 | 不向系统 Python 安装任何包 |

---

## 3. 代码风格与命名

### TypeScript
- `strict: true`，禁用 `any`（确需时用 `unknown` + 收窄）
- 导入顺序：`builtin → external → internal → relative`（`eslint-plugin-import` 强制）
- 禁止深相对导入跨包（`../../` 超过包根即违规）
- 类型定义放 `packages/contracts`，**禁止在 apps 间复制类型**

### Python
- 全量类型注解（`mypy --strict` 零容忍）
- Pydantic v2 模型（`ai` 服务统一响应）
- 不使用 `# type: ignore` 逃逸（除非附 `// reason:` 注释）

### 命名约定
| 实体 | 规则 | 例 |
|---|---|---|
| 数据库表 | 复数 snake_case | `word_mastery` |
| 数据库列 | 蛇形单数 | `word_id` |
| Drizzle 模型 | PascalCase 单数 + `Row` 后缀类型 | `WordMastery` / `WordMasteryRow` |
| NestJS 模块目录 | snake_case | `wordmastery/` |
| NestJS 类 | PascalCase + 后缀 | `WordmasteryService` |
| API 路径 | 复数名词 + kebab | `/error-book` `/daily-review` |
| API 响应包装 | `{ code, message, data }` | |
| React 组件 | PascalCase | `WordCard.tsx` |
| React Hook | `use` 前缀 | `useWordBlock` |
| Python 模块 | snake_case | `phoneme_align.py` |
| 环境变量 | `SCREAMING_SNAKE` | `SCORE_W_ACOUSTIC` |
| feature flag | `FEATURE_` 前缀 | `FEATURE_SHADOWING` |

---

## 4. 分层与依赖边界（🔴 零容忍）

```
基础层  auth / user / taxonomy / dictionary / system / media / db / config
   ↓
内容层  content / lesson
   ↓
业务层  practice / fsrs / wordmastery / errorbook / gamification / game
   ↓
呈现层  recording / pronounce / conversation / report / teacher / parent
   ↓
调度层  scheduler
```

**硬规则**：
1. 依赖只能**向下**，禁止反向 import
2. `scheduler` 依赖下层 service；下层**禁止** import scheduler，业务侧统一通过 `SchedulerService.enqueue()`（位于基础层）
3. `speech-client` / `llm-adapter` / `db` / `config` 是基础设施层，任何层可依赖，它们不依赖业务模块
4. `packages/*` **禁止**依赖 `apps/*`
5. `apps/web` 禁止 import `apps/api` 内部路径
6. `apps/speech`、`apps/ai` 禁止 import `apps/api` 业务模块

CI 强制：ESLint `import/no-cycle` + dependency-cruiser `no-circular`，**0 容忍**。

---

## 5. 质量门禁（全绿才可合并）

| 门禁 | 工具 | 阈值 |
|---|---|---|
| Lint（TS） | ESLint flat config + typescript-eslint + import + react-hooks | 0 error；warning ≤50 且不增长 |
| 循环依赖 | ESLint `import/no-cycle` + dependency-cruiser | **0 容忍** |
| 分层边界 | `.dependency-cruiser.js` | 0 violation |
| 类型检查 | `tsc --noEmit`（strict）、`mypy --strict` | 0 error |
| 格式 | Prettier + `ruff format` | 幂等 |
| 单测覆盖 | Vitest / pytest | api ≥70%、web ≥65%、packages ≥80% |
| **核心算法覆盖** | 同上 | **≥90%**（FSRS、评分公式、词表解析） |
| 评分黄金用例 | `test_scoring_golden.py` | 权重/算法变更须同步更新 golden + bump `formula_version` |
| API 契约 | Redocly lint + diff | 破坏性变更须 CHANGELOG 说明 |
| 依赖漏洞 | `pnpm audit --audit-level=high`、`pip-audit` | 0 high/critical |
| 密钥泄漏 | gitleaks | 0 命中 |
| 镜像安全 | Trivy | 0 critical |

---

## 6. Git 规范

| 分支 | 用途 |
|---|---|
| `main` | 唯一可发布分支，tag 来源。CI 全绿 + 线性历史 + 禁 force push |
| `feature/<模块>-<简述>` | 功能开发，≤5 天 |
| `fix/<简述>` | 缺陷 |
| `docs/…` `chore/…` `refactor/…` | 非功能性 |
| `release/<x.y.z>` | 发布准备，只接受 fix cherry-pick |

**Commit**：Conventional Commits（`feat/fix/docs/refactor/test/build/ci/chore`），Breaking change 带 `!` 并在正文写迁移说明。

**版本号单一来源**：根 `package.json` 的 `version`。CI 用 `ops/scripts/check-version-consistency.mjs` 校验四处一致：根 `package.json` / `ops/fnos/fpk/manifest` / `ops/compose/docker-compose.yaml` 镜像 tag / `fnpack.json`。

---

## 7. 测试策略

| 层 | 范围 | 工具 | 目标 |
|---|---|---|---|
| 单元 | 纯逻辑（FSRS / 评分 / 归一化 / 拼写判分 / 词表导入 / DSL 编译 / 生命周期 / RBAC / 降级链 / 音频工具） | Vitest / pytest | 核心 ≥90% |
| 集成 | 服务间真实模型 | pytest + docker-compose | 🔶 **待 NAS 环境执行** |
| E2E | 浏览器三引擎 + 麦克风 mock | Playwright | 主流程 100% |
| 性能 | 评分 P50/P95、API P95、聚合查询 | k6 / autocannon | 达标或登记豁免 |
| 安全 | 越权 / 路径穿越 / 上传 / JWT / SQLi / XSS / 速率限制 / **零外网** | pytest + Playwright | 0 高危 |
| 兼容 | Web Speech API 差异、Safari 首次手势、Firefox 兜底、iOS mp4 | Playwright 各引擎 | 全绿 |

### 🔶 speech 模块测试架构（重要）

本机无 Docker、无真实模型，**所有 speech 逻辑必须可测**。因此 `apps/speech` 从第一行代码起就强制：

```python
# 依赖注入：所有模型通过 Protocol 注入，测试用 Fake 实现
class PhonemeAligner(Protocol):
    def align(self, wav: np.ndarray, text: str) -> list[PhoneSpan]: ...

class FakeAligner:  # 单测用，无需模型
    def align(self, wav, text): return [PhoneSpan(phone="a", conf=0.9, start=0, end=0.1)]
```

- **单元测试**：注入 Fake，验证纯算法（对齐、评分、置信度、加权、归一化）
- **集成测试**：真实模型，标注 `@pytest.mark.requires_model`，CI nightly，🔶 本机跳过

这样保证逻辑正确性在无模型环境下**完全可验证**，同时不牺牲实机验证能力。

---

## 8. 文档偏离登记（与 03 文档的差异）

> 邢工 2026-10-05 确认：15 项文档缺陷全部按建议处理。以下为偏离明细。

### A 类 · 阻塞级

| ID | 文档原文 | 偏离内容 | 原因 | 影响面 |
|---|---|---|---|---|
| D-01 | 03 §1.2 要求 ESLint 同时用 `typescript-eslint` + `import` + `react-hooks`，示例又用 `.eslintrc` | 改用 **ESLint flat config**（`eslint.config.js`） | `react-hooks` v5 仅支持 flat config（React 19 必需），eslintrc 已被 ESLint 9 移除 | 全仓 lint 配置 |
| D-02 | 03 §1.2 写 `@import "tailwindcss" prefix(tw)` | **放弃 prefix 参数**，改用 CSS 变量 scoping 控制样式作用域 | Tailwind v4 已移除 `prefix` 选项，该写法 v4 下无效 | 前端样式隔离策略 |
| D-03 | 03 §8.3 用 `onlyBuiltDependencies` | 锁定 **pnpm 9.15.0** | 该字段为 pnpm 10 特性，pnpm 9 会报未知字段警告 | 构建脚本字段 |

### B 类 · 数据模型缺陷

| ID | 文档原文 | 偏离内容 | 原因 |
|---|---|---|---|
| D-04 | 03 §4.2.8 `phone_score` 无 `word_id` | **补 `word_id`** | 分析表无单词维度则 REQ-012 音素 Top-N 完全无法实现 |
| D-05 | 03 §4.2.9 `error_sample` 无 `word_id` | **补 `word_id`** | 错题本归因、弱点分析都需按词聚合 |
| D-06 | 03 §4.2 有 6 张表**只有名称无 DDL** | **补齐 DDL**：`parent_children`、`consent_log`、`app_secret`、`app_config`、`system_notice`、`archive_error_sample_archive` | 无 DDL 无法建表 |
| D-07 | 03 §4.3 `word_weakness` 索引写 `uq(unique) + brin(phoneme_error_rate)` | **改为** `uq(user_id, word_id)` + `brin(phoneme_error_rate)` | 物化视图上的唯一索引会自动创建，手写 `uq` 重复且建表失败 |
| D-08 | 03 §4.2.3 `WordEntry` 强制 `license`/`source`；04 附录 B schema 图**未列** | 以 03 为准，**保留 license/source 为必填**，并在 04 schema 图补齐 | 版权红线是硬约束，不允许字段缺失 |

**另补**（对齐 04 文档已确认决策与安全要求）：
- `learning_record` 增 `confidence_level`（高/中/低）、`degrade_level`（A-F 级）— 05 §5.6.3「绝不静默降级」要求
- `user_profile` 增 `calibration_done`、`noise_floor_db` — 05 §5.6.1 规则①首次使用前校准
- 新增 `idempotency_key` 表 — 05 §5.1 大量 API 标注幂等 ✅

### C 类 · 行为歧义

| ID | 文档原文 | 决策 | 原因 |
|---|---|---|---|
| D-09 | 03 §1.15 / §3.1 写「FSRS-6」 | 实现 **FSRS-5**（`fsrs-rs` 0.14），权重文件改名 `fsrs-weights.json` | FSRS 官方最新稳定版为 5.x，文档写 6 无对应实现；文件名去掉版本号避免误导 |
| D-10 | 03 §1.8 写 `drizzle-kit-kit` | 改为 `drizzle-kit` | 文档笔误 |
| D-11 | 02 REQ-007 含 W/S/P/**M** 四形态，M 为 P2 | **MVP 只交付 W/S/P**，M 形（首字母填空/完形填空）记为差异点 | 04 §8.1 MVP 边界未列 M 形生成器 |
| D-12 | 03 §3.1 `report` 模块写「Excel/PDF 导出」 | 以 04 §8.1 REQ-013 为准：**PNG 长图**（Canvas）+ **CSV UTF-8 BOM** | 已确认决策，04 优先于 03 |

### D 类 · 环境

| ID | 问题 | 处理 |
|---|---|---|
| D-13 | 本机 npm registry 不可达 | 项目根 `.npmrc` 配 npmmirror 镜像 |
| D-14 | 本机无 Docker | 容器验证与真实模型测试 → 输出脚本+手册，邢工在 NAS 执行回传 |
| D-15 | Python 3.13 vs 文档 3.12 | `requirements.txt` 用 `>=3.12,<3.14`；不使用 3.12 独有语法 |

### 许可与 AGPL

- 项目 LICENSE = **AGPL-3.0**（邢工已确认接受）
- FSRS4Anki / LibreLingo **仅借鉴算法与设计，不复制代码**（03 §8.4 许可合规门禁）
- 所有借鉴处必须在文件头注明来源
