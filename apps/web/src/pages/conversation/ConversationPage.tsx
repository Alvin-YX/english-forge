import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { PageLoader } from '../../components/common/PageLoader';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import type { ChatReplyView, ConversationView, MessageView, PaginatedResponse } from '../../lib/types';

const MODES = [
  { value: 'chat', label: '日常闲聊', icon: '💬' },
  { value: 'interview', label: '面试模拟', icon: '💼' },
  { value: 'story', label: '故事创作', icon: '📖' },
  { value: 'debate', label: '观点辩论', icon: '⚔️' },
  { value: 'qa', label: '问答答疑', icon: '❓' },
] as const;

type ModeValue = (typeof MODES)[number]['value'];

const MODE_LABELS: Record<string, string> = Object.fromEntries(MODES.map((m) => [m.value, m.label]));
const MODE_ICONS: Record<string, string> = Object.fromEntries(MODES.map((m) => [m.value, m.icon]));

function modeLabel(mode: string) {
  return MODE_LABELS[mode] ?? mode;
}

function modeIcon(mode: string) {
  return MODE_ICONS[mode] ?? '💬';
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ConversationPage() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [convList, setConvList] = useState<ConversationView[]>([]);
  const [current, setCurrent] = useState<ConversationView | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [selectedMode, setSelectedMode] = useState<ModeValue>('chat');
  const [creating, setCreating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** AI 降级提示（后端返回 `degraded: true` 时的原因），持久显示直到下一次成功回复 */
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const loadList = useCallback(async () => {
    try {
      const data = await api.get<PaginatedResponse<ConversationView>>('/conversations?pageSize=50');
      setConvList(data.items ?? []);
    } catch {
      setConvList([]);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Load current conversation + messages when conversationId changes
  useEffect(() => {
    let cancelled = false;
    if (!conversationId) {
      setCurrent(null);
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    setAiNotice(null);
    (async () => {
      try {
        const [conv, msgs] = await Promise.all([
          api.get<ConversationView>('/conversations/' + conversationId),
          api.get<PaginatedResponse<MessageView>>(
            '/conversations/' + conversationId + '/messages?pageSize=100',
          ),
        ]);
        if (!cancelled) {
          setCurrent(conv);
          setMessages(msgs.items ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg((err as Error).message);
          setCurrent(null);
          setMessages([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Auto-scroll on messages change
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content || !conversationId || sending) return;
    setErrorMsg(null);
    setSending(true);
    setTyping(true);
    setInput('');
    try {
      // 走 `/chat`：AI 回复由服务端生成（不走 `/messages`，那个接口只能写入客户端自报的记录）
      const reply = await api.post<ChatReplyView>(
        '/conversations/' + conversationId + '/chat',
        { content },
      );

      // 服务端已落库用户消息，这里一次性追加真实记录
      setMessages((prev) => {
        const next = [...prev, reply.userMessage];
        if (reply.assistantMessage) next.push(reply.assistantMessage);
        return next;
      });

      if (reply.degraded) {
        // 用户消息已保存，只是 AI 没答上来：给出可读原因而不是静默失败
        setAiNotice(reply.reason ?? 'AI 当前不可用');
      } else {
        setAiNotice(null);
      }

      if (current) {
        setCurrent({ ...current, turnCount: current.turnCount + 1 });
      }
      void loadList();
    } catch (err) {
      setInput(content);
      setErrorMsg((err as Error).message || '发送失败，请重试');
    } finally {
      setSending(false);
      setTyping(false);
    }
  }, [input, conversationId, sending, current, loadList]);

  const handleCreate = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setErrorMsg(null);
    try {
      const conv = await api.post<ConversationView>('/conversations', {
        mode: selectedMode,
        level: 'A1',
      });
      setShowNewModal(false);
      navigate('/conversation/' + conv.id);
      void loadList();
    } catch (err) {
      setErrorMsg((err as Error).message || '创建失败，请重试');
    } finally {
      setCreating(false);
    }
  }, [creating, selectedMode, navigate, loadList]);

  const handleFinish = useCallback(async () => {
    if (!current || finishing) return;
    setFinishing(true);
    try {
      const updated = await api.patch<ConversationView>('/conversations/' + current.id + '/finish');
      setCurrent(updated);
      void loadList();
    } catch (err) {
      setErrorMsg((err as Error).message || '结束失败');
    } finally {
      setFinishing(false);
    }
  }, [current, finishing, loadList]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  if (loading) return <PageLoader message="正在加载对话…" />;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4 lg:flex-row">
      {/* Conversation list sidebar */}
      <aside className="flex w-full shrink-0 flex-col border border-slate-200 bg-white rounded-xl shadow-sm lg:w-72">
        <div className="border-b border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">对话历史</h2>
            <Button size="sm" onClick={() => setShowNewModal(true)}>
              ＋ 新对话
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {convList.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-slate-400">
              <span className="text-4xl">💬</span>
              <p className="text-sm">暂无对话</p>
              <p className="text-xs">点击上方按钮开始新对话</p>
            </div>
          ) : (
            <ul className="space-y-1">
              {convList.map((c) => {
                const active = c.id === current?.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => navigate('/conversation/' + c.id)}
                      className={`w-full rounded-lg px-3 py-2.5 text-left transition ${
                        active ? 'bg-primary-50 border border-primary-200' : 'hover:bg-slate-50 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg" aria-hidden>
                          {modeIcon(c.mode)}
                        </span>
                        <span className="flex-1 truncate text-sm font-medium text-slate-800">
                          {modeLabel(c.mode)}
                        </span>
                        {c.status === 'finished' ? (
                          <Badge variant="default">已结束</Badge>
                        ) : c.status === 'active' ? (
                          <Badge variant="success">进行中</Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 flex items-center justify-between pl-7 text-xs text-slate-500">
                        <span>{c.turnCount} 轮</span>
                        <span>{formatDate(c.startedAt)}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Chat area */}
      <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {current ? (
              <>
                <span className="text-xl" aria-hidden>
                  {modeIcon(current.mode)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {modeLabel(current.mode)} · {current.persona}
                  </p>
                  <p className="text-xs text-slate-500">
                    等级 {current.level} · {current.turnCount} 轮 · {current.totalTokens} tokens
                  </p>
                </div>
              </>
            ) : (
              <p className="text-sm font-medium text-slate-500">选择一个对话开始交流</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowNewModal(true)}
              disabled={creating}
              loading={creating}
            >
              新对话
            </Button>
            {current && current.status === 'active' ? (
              <Button size="sm" variant="secondary" onClick={() => void handleFinish()} loading={finishing}>
                结束对话
              </Button>
            ) : null}
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto bg-slate-50/50 p-4">
          {errorMsg ? (
            <div className="rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700">
              {errorMsg}
            </div>
          ) : null}

          {aiNotice ? (
            <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
              <span aria-hidden>⚠️</span>
              <span className="flex-1">AI 未能回复：{aiNotice}</span>
              <button
                type="button"
                onClick={() => setAiNotice(null)}
                className="shrink-0 text-warning-500 hover:text-warning-700"
                aria-label="关闭提示"
              >
                ✕
              </button>
            </div>
          ) : null}

          {!current ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-400">
              <span className="text-6xl">🤖</span>
              <p className="text-lg font-medium text-slate-500">开始一段 AI 对话吧</p>
              <p className="text-sm">选择模式创建新对话，或点击左侧历史对话继续</p>
              <Button onClick={() => setShowNewModal(true)}>＋ 创建新对话</Button>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-slate-400">
              <span className="text-5xl">💬</span>
              <p className="text-sm">这是新的对话，发送第一条消息开始吧</p>
            </div>
          ) : (
            messages.map((m) => {
              const isUser = m.role === 'user';
              return (
                <div
                  key={m.id}
                  className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                      isUser
                        ? 'rounded-br-sm bg-primary-600 text-white'
                        : 'rounded-bl-sm bg-white text-slate-800 border border-slate-200'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                    <p
                      className={`mt-1.5 text-[10px] ${isUser ? 'text-primary-100' : 'text-slate-400'}`}
                    >
                      {formatDate(m.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })
          )}

          {typing ? (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-500 shadow-sm">
                <Spinner size="sm" />
                <span>AI 正在输入…</span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Input */}
        <div className="border-t border-slate-200 p-3">
          {current && current.status !== 'active' ? (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
              <span>
                该对话已{current.status === 'finished' ? '结束' : '出现错误'}，无法继续发送消息
              </span>
              <Button size="sm" variant="outline" onClick={() => setShowNewModal(true)}>
                开新对话
              </Button>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={current ? '输入消息，Enter 发送，Shift+Enter 换行' : '请先创建或选择一个对话'}
                disabled={!current || sending}
                rows={2}
                className="max-h-32 min-h-[44px] flex-1 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200 disabled:bg-slate-50 disabled:text-slate-400"
              />
              <Button
                onClick={() => void handleSend()}
                loading={sending}
                disabled={!current || !input.trim() || sending}
              >
                发送
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* New conversation modal */}
      {showNewModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => !creating && setShowNewModal(false)}>
          <Card className="w-full max-w-lg p-6" interactive={false}>
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-slate-900">创建新对话</h3>
              <p className="mt-0.5 text-sm text-slate-500">选择对话模式，开始 AI 交流</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setSelectedMode(m.value)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-sm transition ${
                    selectedMode === m.value
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-2xl" aria-hidden>
                    {m.icon}
                  </span>
                  <span className="font-medium">{m.label}</span>
                </button>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowNewModal(false)} disabled={creating}>
                取消
              </Button>
              <Button onClick={() => void handleCreate()} loading={creating}>
                创建并开始
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
