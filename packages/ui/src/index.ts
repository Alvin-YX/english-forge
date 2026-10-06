/**
 * @eng-forge/ui — 共享 UI 常量与 token 包
 *
 * 为 Web 前端和 Electron 客户端提供共享的 UI 常量、颜色 token、
 * 尺寸 token 等。避免在多个应用中重复定义。
 */

// ── 颜色 token（与 Tailwind @theme 同步）─────────────────
export const COLORS = {
  primary: {
    50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd',
    400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8',
    800: '#1e40af', 900: '#1e3a8a',
  },
  success: { 500: '#22c55e', 600: '#16a34a' },
  warning: { 500: '#f59e0b', 600: '#d97706' },
  danger: { 500: '#ef4444', 600: '#dc2626' },
  neutral: { 50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db',
            400: '#9ca3af', 500: '#6b7280', 600: '#4b5563', 700: '#374151',
            800: '#1f2937', 900: '#111827' },
} as const;

// ── 尺寸 token ───────────────────────────────────────────
export const SPACING = {
  xs: '0.25rem',  // 4px
  sm: '0.5rem',   // 8px
  md: '1rem',     // 16px
  lg: '1.5rem',   // 24px
  xl: '2rem',     // 32px
  '2xl': '3rem',  // 48px
} as const;

// ── 字号 token ───────────────────────────────────────────
export const FONT_SIZE = {
  xs: '0.75rem',  // 12px
  sm: '0.875rem', // 14px
  base: '1rem',   // 16px
  lg: '1.125rem', // 18px
  xl: '1.25rem',  // 20px
  '2xl': '1.5rem',// 24px
} as const;

// ── 圆角 token ───────────────────────────────────────────
export const RADIUS = {
  sm: '0.25rem',  // 4px
  md: '0.5rem',   // 8px
  lg: '0.75rem',  // 12px
  xl: '1rem',     // 16px
  full: '9999px',
} as const;

// ── 练习卡片类型 ─────────────────────────────────────────
export const PRACTICE_TYPES = ['word_card', 'spell', 'dictation', 'shadowing', 'pronounce', 'sentence', 'conversation', 'listen_identify'] as const;
export type PracticeType = (typeof PRACTICE_TYPES)[number];
