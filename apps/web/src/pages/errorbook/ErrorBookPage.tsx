import { useCallback, useEffect, useState } from 'react';

import { api } from '../../lib/api';
import type { ErrorBookItem } from '../../lib/types';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageLoader } from '../../components/common/PageLoader';

type Tab = 'list' | 'samples';

const CATEGORY_LABEL: Record<string, string> = {
  word: '单词',
  spell: '拼写',
  dictation: '听写',
  pronunciation: '发音',
};

export function ErrorBookPage() {
  const [tab, setTab] = useState<Tab>('list');
  const [items, setItems] = useState<ErrorBookItem[]>([]);
  const [samples, setSamples] = useState<ErrorBookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sampleList] = await Promise.all([
        api.get<ErrorBookItem[]>('/errorbook'),
        api.get<ErrorBookItem[]>('/errorbook/samples'),
      ]);
      setItems(list ?? []);
      setSamples(sampleList ?? []);
      setEmpty(list.length === 0);
    } catch {
      setItems([]);
      setSamples([]);
      setEmpty(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAction = async (item: ErrorBookItem, action: 'resolve' | 'favorite' | 'delete') => {
    try {
      if (action === 'resolve') {
        await api.post(`/errorbook/${item.id}/resolve`);
        setItems((prev) => prev.filter((x) => x.id !== item.id));
      } else if (action === 'delete') {
        await api.delete(`/errorbook/${item.id}`);
        setItems((prev) => prev.filter((x) => x.id !== item.id));
      } else {
        await api.post(`/errorbook/${item.id}/favorite`);
        setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, favorite: !x.favorite } : x)));
      }
    } catch {
      // 静默
    }
  };

  const renderList = (list: ErrorBookItem[]) => {
    if (loading) return <PageLoader message="正在加载错题…" />;
    if (list.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
          <p className="text-5xl">🎉</p>
          <p className="mt-3 font-medium">暂无错题</p>
          <p className="mt-1 text-sm">继续保持，你很棒！</p>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {list.map((item) => (
          <Card key={item.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-semibold text-slate-900">{item.target}</span>
                  {item.translation ? (
                    <span className="text-sm text-slate-500">{item.translation}</span>
                  ) : null}
                  <Badge variant="outline">{CATEGORY_LABEL[item.kind] ?? item.kind}</Badge>
                  {item.favorite ? <Badge variant="warning">★ 收藏</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  错误 {item.totalCount} 次 · 已纠正 {item.correctCount} 次 · 最近 {new Date(item.lastSeenAt).toLocaleDateString('zh-CN')}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="secondary" onClick={() => handleAction(item, 'resolve')}>
                  已掌握
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleAction(item, 'favorite')}>
                  {item.favorite ? '★' : '☆'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleAction(item, 'delete')}>
                  删除
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">错题本 📕</h1>
        <p className="mt-1 text-slate-500">反复错的都在这里，集中攻克！</p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setTab('list')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            tab === 'list' ? 'bg-primary-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
          }`}
        >
          我的错题 ({items.length})
        </button>
        <button
          onClick={() => setTab('samples')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            tab === 'samples' ? 'bg-primary-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
          }`}
        >
          错误样本 ({samples.length})
        </button>
      </div>

      <div>{tab === 'list' ? renderList(items) : renderList(samples)}</div>
    </div>
  );
}
