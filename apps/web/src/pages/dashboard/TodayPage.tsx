import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../../lib/api';
import { Card, StatCard } from '../../components/ui/Card';
import { PageLoader } from '../../components/common/PageLoader';
import { useLearningStore } from '../../stores/learning';
import type { TodayOverview } from '../../stores/learning';

export function TodayPage() {
  const overview = useLearningStore((s) => s.todayOverview);
  const setOverview = useLearningStore((s) => s.setTodayOverview);
  const setHeatmap = useLearningStore((s) => s.setHeatmap);

  useEffect(() => {
    let cancelled = false;
    api
      .get<TodayOverview>('/learning/today')
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch(() => {
        // 后端可能尚未返回完整数据，先留空态
      });

    api
      .get<{ totalWords: number }>('/learning/heatmap')
      .then((data) => {
        if (!cancelled) {
          setHeatmap({ weeks: [], totalWords: data.totalWords });
        }
      })
      .catch(() => {
        // heatmap 数据可选
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const v = overview;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">今日概览</h1>
          <p className="mt-1 text-slate-500">
            {new Date().toLocaleDateString('zh-CN', {
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            })}
          </p>
        </div>
        <Link
          to="/heatmap"
          className="text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          查看热力图 →
        </Link>
      </div>

      {!v ? (
        <PageLoader message="正在加载今日数据…" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="已学词汇" value={v.wordsLearned} icon="📚" accent="primary" />
            <StatCard label="已复习" value={v.wordsReviewed} icon="🔁" accent="info" />
            <StatCard label="学习时长" value={`${v.studyMinutes} 分钟`} icon="⏱️" accent="warning" />
            <StatCard label="当前连击" value={`${v.streakDays} 天`} icon="🔥" accent="success" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">今日 XP</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">
                    +{v.xpGained} XP
                  </p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-100 text-xl">
                  ⭐
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>等级 {v.level}</span>
                  <span>距下一级 {v.xpToNextLevel} XP</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-primary-500 transition-all"
                    style={{ width: `${Math.min(100, (v.xpGained / Math.max(1, v.xpToNextLevel)) * 100)}%` }}
                  />
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="text-base font-semibold text-slate-900">今日小结</h3>
              <p className="mt-2 text-sm text-slate-600">
                {v.wordsLearned + v.wordsReviewed > 0
                  ? `今天共学习 ${v.wordsLearned + v.wordsReviewed} 个词条，继续保持！💪`
                  : '今天还没有学习记录，快开始练习吧 🌱'}
              </p>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-lg font-bold text-primary-700">{v.wordsLearned}</p>
                  <p className="text-xs text-slate-500">新学</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-lg font-bold text-info-700">{v.wordsReviewed}</p>
                  <p className="text-xs text-slate-500">复习</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-lg font-bold text-warning-600">{v.studyMinutes}</p>
                  <p className="text-xs text-slate-500">分钟</p>
                </div>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
