import { useEffect, useMemo, useState } from 'react';

import { PageLoader } from '../../components/common/PageLoader';
import { StateView } from '../../components/common/StateView';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, StatCard } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useResource } from '../../hooks/useResource';
import { api } from '../../lib/api';
import type { ChildView, StudentCandidate } from '../../lib/types';
import { useAuthStore } from '../../stores/auth';

const AVATAR_COLORS = [
  '#2563eb',
  '#059669',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#db2777',
];
const AVATAR_FALLBACK = '#2563eb';

/** 由用户名稳定派生头像色，避免引入随机性导致每次渲染跳色 */
function avatarColorFor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash * 31 + username.charCodeAt(i)) % 99991;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_FALLBACK;
}

/** `GET /users/search` 的 data 段 */
interface StudentSearchResult {
  list: StudentCandidate[];
  total: number;
}

interface Notice {
  tone: 'ok' | 'err';
  text: string;
}

export function ParentDashboard() {
  const role = useAuthStore((s) => s.user?.role);
  const isParent = role === 'parent';

  const { data, loading, error, reload } = useResource<ChildView[]>(
    () => api.get<ChildView[]>('/me/children'),
  );
  const children = useMemo(() => data ?? [], [data]);

  // ── 候选搜索：250ms 防抖 ─────────────────────────────────
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<StudentCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setCandidates([]);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .get<StudentSearchResult>(`/users/search?q=${encodeURIComponent(q)}`)
        .then((res) => {
          if (cancelled) return;
          setCandidates(Array.isArray(res?.list) ? res.list : []);
          setSearchError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setCandidates([]);
          setSearchError(err instanceof Error ? err.message : '搜索失败');
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // ── 绑定 ─────────────────────────────────────────────────
  const [agreed, setAgreed] = useState(false);
  const [binding, setBinding] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function handleBind(username: string) {
    const name = username.trim();
    if (!name || binding) return;
    if (!agreed) {
      setNotice({ tone: 'err', text: '请先勾选知情同意确认' });
      return;
    }

    setBinding(true);
    setNotice(null);
    try {
      // 传 username 而非 childId：家长只知道孩子注册时的用户名
      await api.post<void>('/me/children/bind', { username: name, agreed: true });
      setNotice({ tone: 'ok', text: `已绑定 @${name}` });
      setQuery('');
      setCandidates([]);
      reload();
    } catch (err) {
      setNotice({ tone: 'err', text: err instanceof Error ? err.message : '绑定失败' });
    } finally {
      setBinding(false);
    }
  }

  // ── 解绑 ─────────────────────────────────────────────────
  const [busyChildId, setBusyChildId] = useState<number | null>(null);
  const [unbindError, setUnbindError] = useState<string | null>(null);

  async function handleUnbind(child: ChildView) {
    const label = child.displayName || `@${child.username}`;
    if (!window.confirm(`确定解绑「${label}」？解绑后将无法查看该学生的数据。`)) return;

    setBusyChildId(child.childId);
    setUnbindError(null);
    try {
      await api.post<void>('/me/children/unbind', { childId: child.childId });
      reload();
    } catch (err) {
      setUnbindError(err instanceof Error ? err.message : '解绑失败');
    } finally {
      setBusyChildId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">家长后台 👪</h1>
        <p className="mt-1 text-slate-500">绑定孩子账号，查看其学习进展</p>
      </div>

      {/* 非家长角色：不展示加载/错误态，避免误读成服务故障 */}
      {!isParent ? (
        <Card>
          <StateView
            icon="🔒"
            tone="muted"
            title="该页面仅家长角色可用"
            message="当前账号不是家长角色。请用家长账号注册并登录后访问。"
          />
        </Card>
      ) : loading ? (
        <PageLoader message="正在加载孩子档案…" />
      ) : error ? (
        <Card>
          <StateView title="孩子档案服务暂不可用" message={error} onRetry={reload} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="已绑定学生" value={children.length} icon="👥" accent="primary" />
            <StatCard
              label="待绑定"
              value="—"
              icon="➕"
              accent="info"
              hint="在下方输入学生用户名"
            />
            <StatCard
              label="学习明细"
              value="未接入"
              icon="📈"
              accent="warning"
              hint="按孩子聚合的学习数据接口待实现"
            />
          </div>

          {/* ── 绑定区 ─────────────────────────────────────── */}
          <Card>
            <CardHeader
              title="绑定孩子"
              subtitle="输入孩子注册时使用的用户名，支持模糊搜索"
            />
            <div className="px-5 pb-5">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="输入学生用户名，如 xiaoming"
                    prefix="🔍"
                    disabled={binding}
                  />
                </div>
                <Button
                  loading={binding}
                  disabled={!query.trim()}
                  onClick={() => handleBind(query)}
                >
                  绑定
                </Button>
              </div>

              {/* 候选列表：只在有输入且有结果时展示 */}
              {query.trim() && (searching || candidates.length > 0 || searchError) ? (
                <div className="mt-3">
                  {searching && !searchError ? (
                    <p className="py-2 text-sm text-slate-400">正在搜索…</p>
                  ) : searchError ? (
                    <p className="py-2 text-sm text-danger-600">{searchError}</p>
                  ) : candidates.length === 0 ? (
                    <p className="py-2 text-sm text-slate-400">
                      没有匹配的学生账号，换个关键词试试
                    </p>
                  ) : (
                    <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                      {candidates.map((c) => {
                        const alreadyBound = children.some((b) => b.username === c.username);
                        return (
                          <li key={c.userId} className="flex items-center gap-3 px-3 py-2">
                            <span
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                              style={{ backgroundColor: avatarColorFor(c.username) }}
                            >
                              {(c.displayName ?? c.username).charAt(0)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-900">
                                {c.displayName ?? '未设置昵称'}
                              </p>
                              <p className="truncate text-xs text-slate-500">@{c.username}</p>
                            </div>
                            {alreadyBound ? (
                              <Badge variant="outline">已绑定</Badge>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                loading={binding}
                                onClick={() => handleBind(c.username)}
                              >
                                绑定
                              </Button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ) : null}

              <label className="mt-4 flex items-start gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <span>
                  我已取得该学生或其监护人的知情同意
                  <span className="block text-xs text-slate-400">
                    绑定时会写入 consent_log，用于学习数据的合规追踪
                  </span>
                </span>
              </label>

              {notice ? (
                <p
                  className={`mt-3 text-sm font-medium ${
                    notice.tone === 'ok' ? 'text-success-600' : 'text-danger-600'
                  }`}
                >
                  {notice.text}
                </p>
              ) : null}
            </div>
          </Card>

          {/* ── 已绑定列表 ─────────────────────────────────── */}
          {children.length === 0 ? (
            <Card>
              <StateView
                icon="👥"
                tone="muted"
                title="还没有绑定任何孩子"
                message="在上方输入学生用户名完成绑定；若没有学生账号，请先去注册一个"
              />
            </Card>
          ) : (
            <Card>
              <CardHeader title="已绑定的孩子" subtitle={`共 ${children.length} 位`} />
              <div className="divide-y divide-slate-100">
                {children.map((child) => (
                  <div key={child.childId} className="flex items-center gap-4 px-5 py-4">
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold text-white"
                      style={{ backgroundColor: avatarColorFor(child.username) }}
                    >
                      {child.displayName.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold text-slate-900">
                        {child.displayName}
                      </p>
                      <p className="truncate text-sm text-slate-500">@{child.username}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {new Date(child.createdAt).toLocaleDateString('zh-CN')} 绑定
                      </p>
                    </div>
                    {child.stageCode ? (
                      <Badge variant="info">{child.stageCode}</Badge>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busyChildId === child.childId}
                      className="text-danger-600 hover:bg-danger-50"
                      onClick={() => handleUnbind(child)}
                    >
                      解绑
                    </Button>
                  </div>
                ))}
              </div>
              {unbindError ? (
                <p className="px-5 pb-4 text-sm font-medium text-danger-600">
                  解绑失败：{unbindError}
                </p>
              ) : null}
            </Card>
          )}

          <p className="text-xs text-slate-400">
            目前仅展示绑定关系本身。按孩子聚合的连击天数、今日词量、累计 XP 等明细依赖
            /me/children/:id/stats 端点，后端尚未实现，因此不在此处展示任何估算值。
          </p>
        </>
      )}
    </div>
  );
}
