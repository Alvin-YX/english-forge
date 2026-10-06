import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { api } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useAuthStore } from '../../stores/auth';
import type { AuthUser } from '../../stores/auth';

type LoginResponse = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
};

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setAuth = useAuthStore((s) => s.setAuth);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const navigate = useNavigate();

  if (isAuthenticated) {
    return <Navigate to="/today" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.post<LoginResponse>('/auth/login', { username, password });
      setAuth(data.accessToken, data.refreshToken, data.user);
      navigate('/today', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-100 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-600 text-2xl font-bold text-white">
            E
          </div>
          <h1 className="text-2xl font-bold text-slate-900">EnglishForge</h1>
          <p className="mt-1 text-sm text-slate-500">每日进步一点点 🌱</p>
        </div>

        <Card className="p-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">登录账号</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="用户名"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="请输入用户名"
              required
            />
            <Input
              label="密码"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="请输入密码"
              required
            />
            {error ? (
              <p className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>
            ) : null}
            <Button type="submit" loading={loading} className="w-full">
              {loading ? '登录中…' : '登录'}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-slate-500">
            还没有账号？
            <Link to="/register" className="ml-1 font-medium text-primary-600 hover:text-primary-700">
              立即注册
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
