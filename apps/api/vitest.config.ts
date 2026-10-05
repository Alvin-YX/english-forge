import { defineConfig } from 'vitest/config';

/**
 * apps/api 测试配置。
 *
 * 门禁（03 文档 §8.4）：`src/modules/**` 语句覆盖率 ≥ 80%。
 * 基础层是安全核心（profile_id 隔离），覆盖率下限不得低于此值。
 * `src/infra/**` 与 `src/common/**` 属基础设施层，不在本门禁的 include 内，
 * 但它们由模块集成测试间接执行（本层无业务分支，单独设覆盖率门禁意义不大）。
 *
 * 注意：不 exclude 任何业务文件（含 .module.ts / .dto.ts），避免「把不达标文件
 * 挪出分母」这种假绿。
 */
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts', 'src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      thresholds: {
        statements: 80,
        lines: 80,
        functions: 80,
        branches: 60,
      },
      include: ['src/modules/**/*.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
