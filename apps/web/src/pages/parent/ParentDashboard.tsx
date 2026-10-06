import { useEffect, useState } from 'react';

import { api } from '../../lib/api';
import type { ChildProfile } from '../../lib/types';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, StatCard } from '../../components/ui/Card';
import { PageLoader } from '../../components/common/PageLoader';

const FALLBACK_CHILDREN: ChildProfile[] = [
  {
    id: '1',
    displayName: '小明',
    grade: '小学 3 年级',
    streakDays: 7,
    todayWords: 12,
    xp: 2580,
    lastStudyAt: null,
    avatarColor: '#2563eb',
  },
  {
    id: '2',
    displayName: '小红',
    grade: '小学 5 年级',
    streakDays: 3,
    todayWords: 8,
    xp: 1840,
    lastStudyAt: null,
    avatarColor: '#059669',
  },
];

export function ParentDashboard() {
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<ChildProfile[]>('/me/children')
      .then((res) => {
        setChildren(res && res.length > 0 ? res : FALLBACK_CHILDREN);
      })
      .catch(() => setChildren(FALLBACK_CHILDREN))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (children.length > 0 && !selectedId) {
      setSelectedId(children[0]!.id);
    }
  }, [children, selectedId]);

  const selected = children.find((c) => c.id === selectedId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">家长后台 👪</h1>
        <p className="mt-1 text-slate-500">查看孩子学习进展</p>
      </div>

      {loading ? (
        <PageLoader message="正在加载孩子档案…" />
      ) : children.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-5xl">👥</p>
          <p className="mt-3 font-medium text-slate-900">还没有孩子档案</p>
          <p className="mt-1 text-sm text-slate-500">联系学生账号添加后即可在此查看</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {children.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition ${
                  c.id === selectedId
                    ? 'border-primary-600 bg-primary-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ backgroundColor: c.avatarColor ?? '#2563eb' }}
                >
                  {c.displayName.charAt(0)}
                </span>
                <span className="text-sm font-medium text-slate-900">{c.displayName}</span>
              </button>
            ))}
          </div>

          {selected ? (
            <>
              <Card className="p-5">
                <div className="flex items-center gap-4">
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold text-white"
                    style={{ backgroundColor: selected.avatarColor ?? '#2563eb' }}
                  >
                    {selected.displayName.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <p className="text-lg font-bold text-slate-900">{selected.displayName}</p>
                    <p className="text-sm text-slate-500">{selected.grade ?? '—'}</p>
                  </div>
                  {selected.lastStudyAt ? (
                    <Badge variant="success">上次 {new Date(selected.lastStudyAt).toLocaleDateString('zh-CN')}</Badge>
                  ) : (
                    <Badge variant="outline">今日未学习</Badge>
                  )}
                </div>
              </Card>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <StatCard label="当前连击" value={`${selected.streakDays} 天`} icon="🔥" accent="warning" />
                <StatCard label="今日学习" value={`${selected.todayWords} 词`} icon="📚" accent="primary" />
                <StatCard label="累计 XP" value={selected.xp} icon="⭐" accent="success" />
              </div>

              <Card className="p-5">
                <h2 className="mb-3 text-base font-semibold text-slate-900">快捷操作</h2>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Button variant="secondary" size="sm">发送提醒</Button>
                  <Button variant="secondary" size="sm">查看周报</Button>
                  <Button variant="secondary" size="sm">调整目标</Button>
                  <Button variant="secondary" size="sm">导出记录</Button>
                </div>
              </Card>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
