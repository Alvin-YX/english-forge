import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../../lib/api';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, StatCard } from '../../components/ui/Card';
import { PageLoader } from '../../components/common/PageLoader';
import type {
  BadgeView,
  GameRecordView,
  LeaderboardEntry,
  PaginatedResponse,
  WeeklyChallengeView,
} from '../../lib/types';

const GAME_CODE_OPTIONS = [
  { value: 'word-match', label: '词卡配对' },
  { value: 'spelling', label: '单词拼写' },
  { value: 'dictation', label: '听写挑战' },
  { value: 'quiz', label: '知识问答' },
] as const;

const BADGE_ICONS: Record<string, string> = {
  first_steps: '👣',
  streak_3: '🔥',
  streak_7: '🌋',
  streak_30: '🏆',
  words_50: '📖',
  words_200: '📚',
  words_500: '🏛️',
  game_first: '🎮',
  game_master: '🎯',
  challenge_done: '✅',
  conversation_first: '💬',
  review_master: '🧠',
};

function badgeIcon(code: string) {
  return BADGE_ICONS[code] ?? '🎖️';
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function GamificationPage() {
  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState<BadgeView[]>([]);
  const [challenge, setChallenge] = useState<WeeklyChallengeView | null>(null);
  const [records, setRecords] = useState<PaginatedResponse<GameRecordView> | null>(null);
  const [gameCode, setGameCode] = useState<string>(GAME_CODE_OPTIONS[0].value);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [lbLoading, setLbLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, c, g] = await Promise.all([
        api.get<BadgeView[]>('/gamification/badges').catch(() => [] as BadgeView[]),
        api.get<WeeklyChallengeView | null>('/gamification/challenges/weekly').catch(() => null),
        api.get<PaginatedResponse<GameRecordView>>('/gamification/games?pageSize=20').catch(() => null),
      ]);
      setBadges(b);
      setChallenge(c);
      setRecords(g);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    let cancelled = false;
    setLbLoading(true);
    api
      .get<LeaderboardEntry[]>(`/gamification/games/${encodeURIComponent(gameCode)}/leaderboard?limit=10`)
      .then((data) => {
        if (!cancelled) setLeaderboard(Array.isArray(data) ? data.slice(0, 10) : []);
      })
      .catch(() => {
        if (!cancelled) setLeaderboard([]);
      })
      .finally(() => {
        if (!cancelled) setLbLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameCode]);

  const totalGames = useMemo(() => records?.total ?? 0, [records]);

  if (loading) return <PageLoader message="正在加载游戏化数据…" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">游戏化中心</h1>
          <p className="mt-1 text-slate-500">挑战自己、比拼好友、收集徽章</p>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="已获得徽章" value={badges.length} icon="🏅" accent="primary" />
        <StatCard label="游戏次数" value={totalGames} icon="🎮" accent="info" />
        <StatCard
          label="当前挑战"
          value={challenge ? (challenge.status === 'done' ? '已完成' : '进行中') : '无'}
          icon="🎯"
          accent="success"
        />
      </div>

      <Card className="p-5">
        <CardHeader title="本周挑战" subtitle="完成目标可获得额外积分奖励" />
        {challenge ? (
          <div className="mt-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-lg font-semibold text-slate-900">{challenge.title}</p>
                <p className="mt-0.5 text-sm text-slate-500">
                  指标：{challenge.metric} · 奖励 {challenge.rewardPoints} 积分
                </p>
              </div>
              <Badge variant={challenge.status === 'done' ? 'success' : challenge.status === 'expired' ? 'default' : 'info'}>
                {challenge.status === 'done' ? '✅ 已完成' : challenge.status === 'expired' ? '已过期' : '进行中'}
              </Badge>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="text-slate-600">
                  {challenge.currentValue} / {challenge.targetValue}
                </span>
                <span className="font-medium text-primary-600">
                  {Math.min(100, Math.round((challenge.currentValue / challenge.targetValue) * 100))}%
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary-400 to-primary-600 transition-all"
                  style={{ width: `${Math.min(100, (challenge.currentValue / challenge.targetValue) * 100)}%` }}
                />
              </div>
            </div>
            <p className="text-xs text-slate-400">周期：{challenge.weekStart} 起</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-slate-400">
            <span className="text-4xl">🗓️</span>
            <p className="text-sm">本周暂无挑战</p>
            <p className="text-xs">坚持每天学习，系统会自动为你生成挑战</p>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader title="我的徽章" subtitle="收集你的学习成就" />
          {badges.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-slate-400">
              <span className="text-4xl">🏅</span>
              <p className="text-sm">还没有获得任何徽章</p>
              <p className="text-xs">去练习和学习，解锁第一枚徽章吧！</p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-6">
              {badges.map((b) => (
                <div
                  key={b.code}
                  className="flex flex-col items-center gap-1.5 rounded-lg border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-3 text-center"
                >
                  <span className="text-3xl" aria-hidden>
                    {badgeIcon(b.code)}
                  </span>
                  <span className="text-xs font-medium text-slate-700">{b.code}</span>
                  <span className="text-[10px] text-slate-400">{formatDate(b.earnedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <CardHeader
            title="排行榜"
            subtitle="同游戏玩家分数排行 TOP 10"
            action={
              <select
                value={gameCode}
                onChange={(e) => setGameCode(e.target.value)}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-200"
              >
                {GAME_CODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            }
          />
          <div className="mt-4">
            {lbLoading ? (
              <div className="py-8 text-center text-sm text-slate-400">加载中…</div>
            ) : leaderboard.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-slate-400">
                <span className="text-4xl">📊</span>
                <p className="text-sm">该游戏暂无排行榜数据</p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {leaderboard.map((entry) => (
                  <li
                    key={`${entry.userId}-${entry.rank}`}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        entry.rank === 1
                          ? 'bg-warning-100 text-warning-700'
                          : entry.rank === 2
                            ? 'bg-slate-200 text-slate-700'
                            : entry.rank === 3
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {entry.rank}
                    </span>
                    <span className="flex-1 text-sm text-slate-700">玩家 #{entry.userId}</span>
                    <span className="text-xs text-slate-400">连击 {entry.comboMax}</span>
                    <span className="text-sm font-semibold text-primary-600">{entry.score}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <CardHeader title="游戏记录" subtitle="最近 20 条游戏成绩" />
        {!records || records.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-slate-400">
            <span className="text-4xl">🎮</span>
            <p className="text-sm">暂无游戏记录</p>
            <p className="text-xs">快去练习模式打几分吧！</p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">游戏</th>
                  <th className="px-3 py-2 text-right">得分</th>
                  <th className="px-3 py-2 text-right">最高连击</th>
                  <th className="px-3 py-2 text-right">正确率</th>
                  <th className="px-3 py-2 text-right">用时</th>
                  <th className="px-3 py-2 text-right">日期</th>
                </tr>
              </thead>
              <tbody>
                {records.items.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-slate-800">{r.gameCode}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-primary-600">{r.score}</td>
                    <td className="px-3 py-2.5 text-right">{r.comboMax}x</td>
                    <td className="px-3 py-2.5 text-right">{(r.accuracy * 100).toFixed(0)}%</td>
                    <td className="px-3 py-2.5 text-right text-slate-500">
                      {(r.durationMs / 1000).toFixed(1)}s
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-500">{formatDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
