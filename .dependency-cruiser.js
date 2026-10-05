/**
 * dependency-cruiser 配置 —— 依赖边界校验
 *
 * 依据：03-技术研发方案.md §3.1「禁止循环依赖」+ §8.4「分层边界」质量门禁
 * 详见 CONTRIBUTING.md §4
 *
 * 硬规则：
 *   1. 依赖只能向下，禁止反向 import
 *   2. packages/* 禁止依赖 apps/*
 *   3. apps/web 禁止 import apps/api 内部路径
 *   4. apps/speech、apps/ai 禁止 import apps/api 业务模块
 *   5. 循环依赖 0 容忍
 */

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    // ── 规则 1：循环依赖（0 容忍）──────────────────────────────
    {
      name: 'no-circular',
      severity: 'error',
      comment: '循环依赖违反 03 文档 §3.1 硬性要求，0 容忍',
      from: {},
      to: { circular: true },
    },

    // ── 规则 2：packages 不得依赖 apps ─────────────────────────
    {
      name: 'packages-no-apps',
      severity: 'error',
      comment: 'packages/* 不可依赖 apps/*（防循环，03 文档 8.1 目录约定）',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },

    // ── 规则 3：web 不得 import api 内部 ───────────────────────
    {
      name: 'web-no-api-internal',
      severity: 'error',
      comment: 'apps/web 不得 import apps/api 内部路径；类型共享走 packages/contracts',
      from: { path: '^apps/web/' },
      to: { path: '^apps/api/' },
    },

    // ── 规则 4：Python 服务不得依赖 api 业务模块 ───────────────
    {
      name: 'python-services-no-api',
      severity: 'error',
      comment: 'apps/speech、apps/ai 不得 import apps/api 业务模块（跨进程边界）',
      from: { path: '^apps/(speech|ai)/' },
      to: { path: '^apps/api/' },
    },

    // ── 规则 5：分层边界（后端模块单向依赖）────────────────────
    {
      name: 'backend-layer-boundary',
      severity: 'error',
      comment:
        '后端分层单向依赖：基础层 → 内容层 → 业务层 → 呈现层 → 调度层。禁止反向 import。',
      from: { path: '^apps/api/src/modules/(scheduler|report|parent|teacher|conversation|pronounce|recording)/' },
      to: {
        path: '^apps/api/src/modules/(auth|user|taxonomy|dictionary|content|lesson|fsrs|wordmastery|practice|errorbook|gamification|game|media|system)/',
        // 呈现层与调度层可以依赖下层，此规则仅禁止 scheduler 反向依赖业务层
      },
    },
    {
      name: 'no-reverse-scheduler-dep',
      severity: 'error',
      comment:
        '下层不得反向 import scheduler；业务侧统一通过 SchedulerService.enqueue()（基础层）。见 03 文档 §3.1 规则 2',
      from: {
        path: '^apps/api/src/modules/',
        pathNot: '^apps/api/src/modules/scheduler/',
      },
      to: { path: '^apps/api/src/modules/scheduler/' },
    },

    // ── 规则 6：基础设施层不得依赖业务模块 ─────────────────────
    {
      name: 'infra-no-business-dep',
      severity: 'error',
      comment:
        'speech-client / llm-adapter / db / config 是基础设施层，不依赖任何业务模块。见 03 文档 §3.1 规则 3',
      from: { path: '^apps/api/src/(clients|infra|common)/' },
      to: { path: '^apps/api/src/modules/(?!auth$|user$|taxonomy$)' },
    },

    // ── 规则 7：禁止跨包深相对导入 ─────────────────────────────
    {
      name: 'no-deep-relative-cross-package',
      severity: 'error',
      comment: '禁止 ../../../ 形式的跨包深相对导入，请用包名 + 子路径',
      from: {
        path: '^apps/[^/]+/src/|^packages/[^/]+/src/',
      },
      to: {
        path: '\\.\\./\\.\\./\\.\\./',
      },
    },

    // ── 规则 8：模块层禁止直连 drizzle-orm（profile-scope-chokepoint）──
    {
      name: 'profile-scope-chokepoint',
      severity: 'error',
      comment:
        '🔴 所有 src/modules/** 下的文件禁止直接 import drizzle-orm，' +
        '算子一律从 infra/db/query.ts 取用（ADR-0004 第三层防线）',
      from: { path: '^apps/api/src/modules/' },
      to: { path: 'drizzle-orm' },
    },

    // ── 规则 9：禁止依赖未声明的隐式模块 ───────────────────────
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: '孤立文件：未被任何其他文件 import 的模块（入口文件除外属正常）',
      from: { orphanOnly: true },
      to: {},
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: '(^|/)(node_modules|dist|build|coverage|\\.venv|generated)(/|$)',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.base.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)' },
      text: { collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)' },
    },
  },
};
