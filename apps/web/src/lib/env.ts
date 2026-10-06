/**
 * 前端环境常量。Vite 仅在构建期把 VITE_ 前缀的环境变量暴露到 import.meta.env。
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export const TOKEN_KEY_ACCESS = 'ef_access_token';
export const TOKEN_KEY_REFRESH = 'ef_refresh_token';
export const TOKEN_KEY_USER = 'ef_user';
