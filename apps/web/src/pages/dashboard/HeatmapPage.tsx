import { useMemo, useState } from 'react';

import { PageLoader } from '../../components/common/PageLoader';
import { StateView } from '../../components/common/StateView';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { useResource } from '../../hooks/useResource';
import { api } from '../../lib/api';
import type { HeatmapCell, HeatmapData } from '../../stores/learning';

const levelColors: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-slate-200',
  1: 'bg-primary-200',
  2: 'bg-primary-300',
  3: 'bg-primary-500',
  4: 'bg-primary-700',
};

function levelOf(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (count <= 5) return 1;
  if (count <= 15) return 2;
  if (count <= 30) return 3;
  return 4;
}

const dayLabels = ['一', '二', '三', '四', '五', '六', '日'];

export function HeatmapPage() {
  const { data, loading, error, reload } = useResource<HeatmapData>(
    async () => api.get<HeatmapData>('/learning/heatmap'),
  );
  const [selected, setSelected] = useState<HeatmapCell | null>(null);

  const weeks = data?.weeks ?? [];
  const totalWords = useMemo(() => data?.totalWords ?? 0, [data]);

  if (loading) return <PageLoader message="正在加载热力图…" />;

  if (error) {
    return (
      <Card>
        <StateView
          title="学习记录服务暂不可用"
          message={error}
          onRetry={reload}
        />
      </Card>
    );
  }

  // 后端返回空周列表，与"服务不可用"是两回事 —— 前者是还没有任何学习记录
  if (weeks.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">学习热力图</h1>
          <p className="mt-1 text-slate-500">过去 12 周的学习记录一览</p>
        </div>
        <Card>
          <StateView
            icon="📭"
            tone="muted"
            title="还没有学习记录"
            message="完成任何一次跟读、拼写或听写练习后，热力图就会开始记录。"
            onRetry={reload}
            retryLabel="重新检查"
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">学习热力图</h1>
          <p className="mt-1 text-slate-500">过去 12 周的学习记录一览</p>
        </div>
        <Badge variant="info">累计 {totalWords} 个词条</Badge>
      </div>

      <Card className="p-5">
        <div className="overflow-x-auto">
          <div className="flex min-w-[640px] gap-2">
            <div className="flex flex-col gap-1 pr-1 text-xs text-slate-400">
              {dayLabels.map((d, i) => (
                <div key={d} className="flex h-5 items-center">
                  {i % 2 === 0 ? d : ''}
                </div>
              ))}
            </div>
            <div className="flex flex-1 gap-1">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-1">
                  {week.map((cell) => (
                    <button
                      key={cell.date}
                      type="button"
                      onClick={() => setSelected(cell)}
                      title={`${cell.date} · ${cell.count} 词`}
                      className={`h-5 w-5 rounded-sm transition hover:ring-2 hover:ring-primary-400 ${levelColors[levelOf(cell.count)]}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
          <span>少</span>
          <div className="flex gap-1">
            {([0, 1, 2, 3, 4] as const).map((lvl) => (
              <div key={lvl} className={`h-4 w-4 rounded-sm ${levelColors[lvl]}`} />
            ))}
          </div>
          <span>多</span>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-base font-semibold text-slate-900">选中日期</h2>
        {selected ? (
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 flex-col items-center justify-center rounded-xl bg-primary-50">
              <p className="text-2xl font-bold text-primary-700">{selected.count}</p>
              <p className="text-xs text-slate-500">词条</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">日期</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{selected.date}</p>
              <p className="mt-1 text-xs text-slate-500">
                {selected.count === 0
                  ? '当日未学习'
                  : `活跃度等级 ${levelOf(selected.count)}/4`}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">点击热力图中的方格查看当日详情</p>
        )}
      </Card>
    </div>
  );
}
