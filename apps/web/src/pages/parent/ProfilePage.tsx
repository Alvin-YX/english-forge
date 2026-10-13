import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { PageLoader } from '../../components/common/PageLoader';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';

/** GET /me 的返回体，与后端 UserProfileView 对齐（档案字段嵌在 profile 里） */
interface MeResponse {
  userId: number;
  username: string;
  displayName: string;
  role: 'student' | 'parent' | 'admin';
  email?: string;
  phone?: string;
  status: string;
  profile: {
    locale?: string;
    accent?: 'us' | 'uk';
    speechRate?: string;
    perfTier?: string;
    asrModel?: string;
    dailyGoalMin?: number;
    reportFrequency?: string;
    stageCode?: string;
    stageId?: number;
    calibrationDone?: boolean;
  };
}

/** 页面内使用的摊平视图 */
interface ProfileDetail {
  id: number;
  username: string;
  displayName: string;
  role: 'student' | 'parent' | 'admin';
  email?: string;
  dailyGoalMinutes: number;
  accent?: 'us' | 'uk';
}

/** 后端字段名是 dailyGoalMin，页面用 dailyGoalMinutes，这里统一摊平 */
function toProfileDetail(me: MeResponse): ProfileDetail {
  return {
    id: me.userId,
    username: me.username,
    displayName: me.displayName,
    role: me.role,
    email: me.email,
    dailyGoalMinutes: me.profile?.dailyGoalMin ?? 30,
    accent: me.profile?.accent,
  };
}

export function ProfilePage() {
  const storedUser = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [profile, setProfile] = useState<ProfileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState<number>(30);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // 立刻用登录时写入的 user 兜底渲染，避免接口慢时页面空白
    if (storedUser) {
      setProfile({
        id: storedUser.id,
        username: storedUser.username,
        displayName: storedUser.displayName,
        role: storedUser.role,
        dailyGoalMinutes: 30,
      });
      setDisplayName(storedUser.displayName);
    }

    api
      .get<MeResponse>('/me')
      .then((me) => {
        if (cancelled) return;
        const detail = toProfileDetail(me);
        setProfile(detail);
        setDisplayName(detail.displayName);
        setDailyGoalMinutes(detail.dailyGoalMinutes);
        setUser({
          id: me.userId,
          username: me.username,
          displayName: me.displayName,
          role: me.role,
        });
      })
      .catch(() => {
        if (!cancelled) setError('资料加载失败，请退出后重新登录');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [storedUser, setUser]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      // 后端 UPDATE_PROFILE_SCHEMA 的字段名是 dailyGoalMin，不是 dailyGoalMinutes
      const me = await api.patch<MeResponse>('/me/profile', {
        displayName,
        dailyGoalMin: dailyGoalMinutes,
      });
      const detail = toProfileDetail(me);
      setProfile(detail);
      setUser({
        id: me.userId,
        username: me.username,
        displayName: me.displayName,
        role: me.role,
      });
      setMessage('保存成功 ✓');
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 只在「连兜底的 user 都没有」时才转圈，接口失败会走 error 分支而不是永久 loading
  if (loading && !profile) {
    return <PageLoader message="正在加载个人资料…" />;
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <p className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error ?? '无法获取个人资料，请退出后重新登录'}
        </p>
      </div>
    );
  }

  const initial = (profile.displayName || profile.username || 'U').charAt(0).toUpperCase();
  const roleLabel =
    profile.role === 'parent' ? '家长' : profile.role === 'admin' ? '管理员' : '学生';

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">我的资料 ⚙️</h1>
        <p className="mt-1 text-slate-500">管理你的账号信息</p>
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-600 text-2xl font-bold text-white">
            {initial}
          </div>
          <div>
            <p className="text-lg font-bold text-slate-900">{profile.displayName}</p>
            <p className="text-sm text-slate-500">@{profile.username}</p>
            <div className="mt-1 flex gap-2">
              <Badge variant="info">{roleLabel}</Badge>
              {profile.email ? (
                <Badge variant="outline">{profile.email}</Badge>
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

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">发音口音</label>
            <select
              value={profile.accent ?? 'us'}
              onChange={(e) => setProfile({ ...profile, accent: e.target.value as 'us' | 'uk' })}
              className="h-10 w-full rounded-[var(--radius-btn)] border border-slate-300 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
            >
              <option value="us">美式</option>
              <option value="uk">英式</option>
            </select>
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
