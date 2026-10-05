/**
 * ESLint flat config —— 见 CONTRIBUTING.md D-01
 *
 * 为什么用 flat config：03 文档 §1.2 要求 eslint-plugin-react-hooks，
 * 而该插件 v5 仅支持 flat config（React 19 必需），且 ESLint 9 已移除 eslintrc。
 * 这是对文档 §1.2 示例的偏离，理由见 CONTRIBUTING.md 偏离登记 D-01。
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.venv/**',
      '**/generated/**',
      'packages/contracts/src/generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── 基础 TS 规则 ──────────────────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: true,
        node: true,
      },
      // 循环依赖检测的性能优化：跳过 node_modules 与生成物
      'import/ignore': ['node_modules', '.*/generated/.*'],
      react: { version: 'detect' },
    },
    rules: {
      // 禁止 any（CONTRIBUTING.md §3）
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // ── 循环依赖：0 容忍（03 文档 §8.4）────────────────────
      // 由 eslint-plugin-import 内置的 import/no-cycle 提供
      'import/no-cycle': ['error', { maxDepth: '∞' }],

      // ── 导入规范（CONTRIBUTING.md §3）───────────────────────
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'error',
      'import/no-self-import': 'error',
    },
  },

  // ── React / React Hooks（仅 web 与 ui 包）─────────────────
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // React 17+ 新 JSX transform
      'react/prop-types': 'off', // TS 已提供类型
    },
  },

  // ── 测试文件放宽 ──────────────────────────────────────────
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/tests/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // ── 配置与脚本文件（Node 环境）────────────────────────────
  {
    files: ['*.js', '*.mjs', '*.cjs', 'ops/scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // ── 必须放在最后：关闭与 Prettier 冲突的规则 ──────────────
  prettierConfig,
);
