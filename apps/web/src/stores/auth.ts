import { create } from 'zustand';

import { TOKEN_KEY_ACCESS, TOKEN_KEY_REFRESH, TOKEN_KEY_USER } from '../lib/env';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: 'student' | 'parent' | 'admin';
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  setAuth: (accessToken: string, refreshToken: string, user: AuthUser) => void;
  clearAuth: () => void;
  setUser: (user: AuthUser) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
}

function readStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(TOKEN_KEY_USER);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  setAuth: (accessToken, refreshToken, user) => {
    localStorage.setItem(TOKEN_KEY_ACCESS, accessToken);
    localStorage.setItem(TOKEN_KEY_REFRESH, refreshToken);
    localStorage.setItem(TOKEN_KEY_USER, JSON.stringify(user));
    set({ accessToken, refreshToken, user, isAuthenticated: true, error: null });
  },

  clearAuth: () => {
    localStorage.removeItem(TOKEN_KEY_ACCESS);
    localStorage.removeItem(TOKEN_KEY_REFRESH);
    localStorage.removeItem(TOKEN_KEY_USER);
    set({ accessToken: null, refreshToken: null, user: null, isAuthenticated: false, error: null });
  },

  setUser: (user) => {
    localStorage.setItem(TOKEN_KEY_USER, JSON.stringify(user));
    set({ user });
  },

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));

/**
 * 应用启动时从 localStorage 恢复登录态。
 * 在 main.tsx 中调用一次即可。
 */
export function initAuthState(): void {
  const accessToken = localStorage.getItem(TOKEN_KEY_ACCESS);
  const refreshToken = localStorage.getItem(TOKEN_KEY_REFRESH);
  const user = readStoredUser();
  if (accessToken && user) {
    useAuthStore.setState({
      accessToken,
      refreshToken,
      user,
      isAuthenticated: true,
    });
  }
}

/** 便于在 api.ts 等模块中同步清理，避免循环依赖。 */
export function clearAuth(): void {
  useAuthStore.getState().clearAuth();
}
