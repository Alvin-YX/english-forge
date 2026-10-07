import { useEffect } from 'react';

import { PageLoader } from '../../components/common/PageLoader';
import { Card, StatCard } from '../../components/ui/Card';
import { api } from '../../lib/api';
import { useLearningStore } from '../../stores/learning';
import type { StreakState } from '../../stores/learning';

export function StreakPage() {
  const streak = useLearningStore((s) => s.streak);
  const setStreak = useLearningStore((s) => s.setStreak);

  useEffect(() => {
    api
      .get<StreakState>('/learning/streak')
      .then(setStreak)
      .catch(() => {
        // ignore
      });
  }, [setStreak]);

  if (!streak) {
    return <PageLoader message="正在加载连击数据…" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">学习连击 🔥</h1>
        <p className="mt-1 text-slate-500">坚持每天学习，越连越长！</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="当前连击" value={`${streak.currentStreak} 天`} icon="🔥" accent="warning" />
        <StatCard label="最长记录" value={`${streak.longestStreak} 天`} icon="🏆" accent="success" />
        <StatCard label="冻结卡可用" value={`${streak.freezeAvailable} 张`} icon="❄️" accent="info" />
      </div>

      <Card className="p-6">
        <h2 className="mb-3 text-base font-semibold text-slate-900">连击进度</h2>
        {streak.currentStreak === 0 ? (
          <div className="flex items-center gap-4 rounded-xl bg-warning-50 p-4">
            <span className="text-3xl">🌱</span>
            <div>
              <p className="font-medium text-slate-900">今天还没开始哦</p>
              <p className="text-sm text-slate-600">完成一次练习即可开启今日连击</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-6">
            <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-warning-500 to-danger-500 text-white">
              <div className="text-center">
                <p className="text-4xl font-bold">{streak.currentStreak}</p>
                <p className="text-xs">天</p>
              </div>
              <div className="absolute -right-1 -top-1 text-3xl">🔥</div>
            </div>
            <div className="flex-1">
              <p className="text-sm text-slate-500">开始日期</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {streak.streakStartAt
                  ? new Date(streak.streakStartAt).toLocaleDateString('zh-CN')
                  : '—'}
              </p>
              {streak.freezeAvailable > 0 ? (
                <p className="mt-2 text-xs text-info-600">
                  还有 {streak.freezeAvailable} 张冻结卡可续命 ❄️
                </p>
              ) : null}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
