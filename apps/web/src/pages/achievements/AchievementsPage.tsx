import { useCallback, useEffect, useState } from 'react';

import { api } from '../../lib/api';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, StatCard } from '../../components/ui/Card';
import { PageLoader } from '../../components/common/PageLoader';
import type {
  BadgeView,
  GameRecordView,
  PaginatedResponse,
  WeeklyChallengeView,
} from '../../lib/types';

interface BadgeMeta {
  code: string;
  name: string;
  icon: string;
  description: string;
}

const ALL_BADGES: BadgeMeta[] = [
  { code: 'first_steps', name: '初出茅庐', icon: '👣', description: '完成第一次学习' },
  { code: 'streak_3', name: '三日之约', icon: '🔥', description: '连续学习 3 天' },
  { code: 'streak_7', name: '一周达人', icon: '🌋', description: '连续学习 7 天' },
  { code: 'streak_30', name: '月度大师', icon: '🏆', description: '连续学习 30 天' },
  { code: 'words_50', name: '入门词汇', icon: '📖', description: '累计学习 50 个单词' },
  { code: 'words_200', name: '词汇达人', icon: '📚', description: '累计学习 200 个单词' },
  { code: 'words_500', name: '词汇大师', icon: '🏛️', description: '累计学习 500 个单词' },
  { code: 'game_first', name: '首次闯关', icon: '🎮', description: '完成第一局游戏' },
  { code: 'game_master', name: '游戏高手', icon: '🎯', description: '单局得分超过 1000' },
  { code: 'challenge_done', name: '挑战完成', icon: '✅', description: '完成第一个周挑战' },
  { code: 'conversation_first', name: '初次对话', icon: '💬', description: '完成第一次 AI 对话' },
  { code: 'review_master', name: '复习大师', icon: '🧠', description: '累计复习 100 次' },
];

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function AchievementsPage() {
  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState<BadgeView[]>([]);
  const [games, setGames] = useState<PaginatedResponse<GameRecordView> | null>(null);
  const [challenges, setChallenges] = useState<PaginatedResponse<WeeklyChallengeView> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, g, c] = await Promise.all([
        api.get<BadgeView[]>('/gamification/badges').catch(() => [] as BadgeView[]),
        api.get<PaginatedResponse<GameRecordView>>('/gamification/games?pageSize=1').catch(() => null),
        api
          .get<PaginatedResponse<WeeklyChallengeView>>(
            '/gamification/challenges?status=done&pageSize=20',
          )
          .catch(() => null),
      ]);
      setBadges(b);
      setGames(g);
      setChallenges(c);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const earnedMap = new Map(badges.map((b) => [b.code, b.earnedAt]));
  const totalGames = games?.total ?? 0;
  const totalRewards = (challenges?.items ?? []).reduce((sum, c) => sum + c.rewardPoints, 0);
  const completedChallenges = (challenges?.items ?? []).filter((c) => c.status === 'done');

  if (loading) return <PageLoader message="正在加载成就数据…" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">成就中心</h1>
          <p className="mt-1 text-slate-500">查看所有徽章与已完成挑战</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadAll()}>
          🔄 刷新
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700">
          加载失败：{error}
        </div>
      ) : null}

      {/* Stats summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="已获得徽章" value={`${badges.length} / ${ALL_BADGES.length}`} icon="🏅" accent="primary" />
        <StatCard label="游戏次数" value={totalGames} icon="🎮" accent="info" />
        <StatCard label="已完成挑战" value={completedChallenges.length} icon="✅" accent="success" />
        <StatCard label="累计奖励积分" value={totalRewards} icon="🎁" accent="warning" />
      </div>

      {/* Badge grid */}
      <Card className="p-5">
        <CardHeader
          title="徽章墙"
          subtitle="已获得徽章正常显示，未获得的以灰显表示"
          action={
            <Badge variant={badges.length > 0 ? 'success' : 'default'}>
              {badges.length} / {ALL_BADGES.length}
            </Badge>
          }
        />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {ALL_BADGES.map((meta) => {
            const earnedAt = earnedMap.get(meta.code);
            const earned = Boolean(earnedAt);
            return (
              <div
                key={meta.code}
                className={`flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition ${
                  earned
                    ? 'border-primary-200 bg-gradient-to-b from-primary-50 to-white'
                    : 'border-slate-200 bg-slate-50 opacity-60 grayscale'
                }`}
              >
                <span className="text-4xl" aria-hidden>
                  {meta.icon}
                </span>
                <div>
                  <p className={`text-sm font-semibold ${earned ? 'text-slate-900' : 'text-slate-500'}`}>
                    {meta.name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">{meta.description}</p>
                </div>
                {earned && earnedAt ? (
                  <Badge variant="success">
                    📅 {formatDate(earnedAt)}
                  </Badge>
                ) : (
                  <Badge variant="outline">🔒 未解锁</Badge>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Challenge history */}
      <Card className="p-5">
        <CardHeader title="挑战历史" subtitle="已完成的周挑战记录" />
        {completedChallenges.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-slate-400">
            <span className="text-4xl">✅</span>
            <p className="text-sm">暂无已完成的挑战</p>
            <p className="text-xs">坚持每天学习，完成第一个挑战吧！</p>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {completedChallenges.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl" aria-hidden>
                    🏆
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{c.title}</p>
                    <p className="text-xs text-slate-500">
                      {c.weekStart} 起 · {c.metric} · 进度 {c.currentValue}/{c.targetValue}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-9 sm:pl-0">
                  <Badge variant="success">+{c.rewardPoints} 积分</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
