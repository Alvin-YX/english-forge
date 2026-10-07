import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import type { AuthUser } from '../../stores/auth';

type RegisterResponse = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
};

export function RegisterPage() {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<'student' | 'parent'>('student');
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
    if (!username || !displayName || !password) {
      setError('请填写所有必填项');
      return;
    }
    if (username.length < 3) {
      setError('用户名至少 3 个字符');
      return;
    }
    if (password.length < 6) {
      setError('密码至少 6 位');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.post<RegisterResponse>('/auth/register', {
        username,
        displayName,
        password,
        role,
      });
      setAuth(data.accessToken, data.refreshToken, data.user);
      navigate('/today', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败，请稍后再试');
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
          <p className="mt-1 text-sm text-slate-500">创建新账号</p>
        </div>

        <Card className="p-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">注册账号</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="用户名"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="至少 3 个字符"
              required
            />
            <Input
              label="显示名称"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="如：小明 / 李爸爸"
              required
            />
            <Input
              label="密码"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              required
            />
            <Input
              label="确认密码"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="再次输入密码"
              required
            />
            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700">身份</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRole('student')}
                  className={`h-10 rounded-lg border text-sm font-medium transition ${
                    role === 'student'
                      ? 'border-primary-600 bg-primary-50 text-primary-700'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  👦 学生
                </button>
                <button
                  type="button"
                  onClick={() => setRole('parent')}
                  className={`h-10 rounded-lg border text-sm font-medium transition ${
                    role === 'parent'
                      ? 'border-primary-600 bg-primary-50 text-primary-700'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  👪 家长
                </button>
              </div>
            </div>
            {error ? (
              <p className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>
            ) : null}
            <Button type="submit" loading={loading} className="w-full">
              {loading ? '注册中…' : '注册'}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-slate-500">
            已有账号？
            <Link to="/login" className="ml-1 font-medium text-primary-600 hover:text-primary-700">
              直接登录
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
