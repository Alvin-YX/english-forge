import type { ApiResponse } from '@eng-forge/contracts';

import { clearAuth } from '../stores/auth';

import { API_BASE_URL, TOKEN_KEY_ACCESS, TOKEN_KEY_REFRESH } from './env';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string | number;

  constructor(status: number, code: string | number, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

type ApiOptions = Omit<globalThis.RequestInit, 'body'> & {
  body?: unknown;
  skipAuth?: boolean;
  signal?: AbortSignal;
};

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = localStorage.getItem(TOKEN_KEY_REFRESH);
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const envelope = (await res.json()) as ApiResponse<
        { accessToken: string; refreshToken?: string }
      >;
      localStorage.setItem(TOKEN_KEY_ACCESS, envelope.data.accessToken);
      if (envelope.data.refreshToken) {
        localStorage.setItem(TOKEN_KEY_REFRESH, envelope.data.refreshToken);
      }
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, skipAuth, headers: extraHeaders, ...rest } = options;
  const headers = new Headers(extraHeaders);

  if (body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (!skipAuth) {
    const accessToken = localStorage.getItem(TOKEN_KEY_ACCESS);
    if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiClientError(0, 'NETWORK', `网络异常：${(err as Error).message}`);
  }

  let envelope: ApiResponse<T> | undefined;
  try {
    envelope = (await res.json()) as ApiResponse<T>;
  } catch {
    // 非 JSON 响应（例如 401 HTML 页面）
  }

  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const accessToken = localStorage.getItem(TOKEN_KEY_ACCESS);
      headers.set('authorization', `Bearer ${accessToken}`);
      const retry = await fetch(`${API_BASE_URL}${path}`, {
        ...rest,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!retry.ok) {
        clearAuth();
        window.location.href = '/login';
        throw new ApiClientError(retry.status, 'AUTH', '登录已过期，请重新登录');
      }
      try {
        const retryEnvelope = (await retry.json()) as ApiResponse<T>;
        return retryEnvelope.data as T;
      } catch {
        throw new ApiClientError(retry.status, 'BAD_RESPONSE', '服务器返回异常');
      }
    }
    clearAuth();
    window.location.href = '/login';
    throw new ApiClientError(401, 'UNAUTHORIZED', '登录已过期，请重新登录');
  }

  if (!res.ok) {
    const code = envelope?.code ?? res.status;
    const message = envelope?.message ?? `请求失败 (${res.status})`;
    throw new ApiClientError(res.status, code, message);
  }

  if (!envelope) {
    throw new ApiClientError(res.status, 'BAD_RESPONSE', '服务器返回异常');
  }

  return envelope.data;
}

async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const accessToken = localStorage.getItem(TOKEN_KEY_ACCESS);
  const headers = new Headers();
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  const envelope = (await res.json()) as ApiResponse<T>;
  if (!res.ok) {
    throw new ApiClientError(res.status, envelope.code, envelope.message);
  }
  return envelope.data;
}

export const api = {
  get: <T>(path: string, init?: ApiOptions) => apiRequest<T>(path, { ...init, method: 'GET' }),
  post: <T>(path: string, body?: unknown, init?: ApiOptions) =>
    apiRequest<T>(path, { ...init, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, init?: ApiOptions) =>
    apiRequest<T>(path, { ...init, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, init?: ApiOptions) =>
    apiRequest<T>(path, { ...init, method: 'PUT', body }),
  delete: <T>(path: string, init?: ApiOptions) =>
    apiRequest<T>(path, { ...init, method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => apiUpload<T>(path, formData),
};
