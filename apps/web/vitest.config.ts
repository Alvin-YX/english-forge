import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // apps/web 目前尚无测试用例；没有测试文件时应正常退出而非报 "No test files found"
    passWithNoTests: true,
  },
});
