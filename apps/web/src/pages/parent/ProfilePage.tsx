import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { PageLoader } from '../../components/common/PageLoader';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import type { AuthUser } from '../../stores/auth';

interface ProfileDetail extends AuthUser {
  email?: string;
  createdAt?: string;
  dailyGoalMinutes?: number;
  accent?: 'uk' | 'us';
}

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [profile, setProfile] = useState<ProfileDetail | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState<number>(30);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ProfileDetail>('/me/profile')
      .then((data) => {
        setProfile(data);
        setDisplayName(data.displayName ?? user?.displayName ?? '');
        setDailyGoalMinutes(data.dailyGoalMinutes ?? 30);
      })
      .catch(() => {
        setProfile(user ?? null);
        setDisplayName(user?.displayName ?? '');
      });
  }, [user]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const updated = await api.patch<ProfileDetail>('/me/profile', {
        displayName,
        dailyGoalMinutes,
      });
      setProfile(updated);
      setUser({
        id: updated.id,
        username: updated.username,
        displayName: updated.displayName,
        role: updated.role,
      });
      setMessage('保存成功 ✓');
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!profile) {
    return <PageLoader message="正在加载个人资料…" />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">我的资料 ⚙️</h1>
        <p className="mt-1 text-slate-500">管理你的账号信息</p>
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-600 text-2xl font-bold text-white">
            {profile.displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-lg font-bold text-slate-900">{profile.displayName}</p>
            <p className="text-sm text-slate-500">@{profile.username}</p>
            <div className="mt-1 flex gap-2">
              <Badge variant="info">
                {profile.role === 'parent' ? '家长' : profile.role === 'admin' ? '管理员' : '学生'}
              </Badge>
              {profile.createdAt ? (
                <Badge variant="outline">
                  加入于 {new Date(profile.createdAt).toLocaleDateString('zh-CN')}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="显示名称"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">每日目标（分钟）</label>
            <input
              type="number"
              min={5}
              max={240}
              value={dailyGoalMinutes}
              onChange={(e) => setDailyGoalMinutes(Math.max(5, Math.min(240, Number(e.target.value) || 30)))}
              className="h-10 w-full rounded-[var(--radius-btn)] border border-slate-300 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
            <p className="mt-1 text-xs text-slate-500">建议 15-60 分钟</p>
          </div>

          {message ? (
            <p className="rounded-md bg-success-50 px-3 py-2 text-sm text-success-700">{message}</p>
          ) : null}
          {error ? (
            <p className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>
          ) : null}

          <Button type="submit" loading={saving}>
            {saving ? '保存中…' : '保存修改'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
