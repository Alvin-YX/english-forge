import { useCallback, useEffect, useMemo, useState } from 'react';

import { PageLoader } from '../../components/common/PageLoader';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, StatCard } from '../../components/ui/Card';
import { api } from '../../lib/api';
import type {
  CsvExportView,
  MonthlyReportView,
  WeeklyReportView,
} from '../../lib/types';

type Period = 'weekly' | 'monthly';

function toDateString(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatWeekStart(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ReportPage() {
  const today = useMemo(() => new Date(), []);
  // Default week: 7 days ago ending today
  const defaultWeekStart = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 6);
    return toDateString(d);
  }, [today]);
  const defaultYear = today.getFullYear();
  const defaultMonth = today.getMonth() + 1;

  const [period, setPeriod] = useState<Period>('weekly');
  const [weekStart, setWeekStart] = useState(defaultWeekStart);
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);

  const [weekly, setWeekly] = useState<WeeklyReportView | null>(null);
  const [monthly, setMonthly] = useState<MonthlyReportView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'learning_records' | 'word_mastery' | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (period === 'weekly') {
        const data = await api.get<WeeklyReportView>('/report/weekly?weekStart=' + weekStart);
        setWeekly(data);
      } else {
        const data = await api.get<MonthlyReportView>(
          '/report/monthly?year=' + year + '&month=' + month,
        );
        setMonthly(data);
      }
    } catch (err) {
      setError((err as Error).message);
      setWeekly(null);
      setMonthly(null);
    } finally {
      setLoading(false);
    }
  }, [period, weekStart, year, month]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const handleExport = useCallback(
    async (type: 'learning_records' | 'word_mastery') => {
      setExporting(type);
      setError(null);
      try {
        const startDate = period === 'weekly' ? weekStart : toDateString(new Date(year, month - 1, 1));
        const endDate = toDateString(today);
        const qs = `type=${type}&startDate=${startDate}&endDate=${endDate}`;
        const data = await api.get<CsvExportView>('/report/export/csv?' + qs);
        downloadCsv(data.filename, data.content);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setExporting(null);
      }
    },
    [period, weekStart, year, month, today],
  );

  const handlePrevPeriod = useCallback(() => {
    if (period === 'weekly') {
      const d = new Date(weekStart + 'T00:00:00');
      d.setDate(d.getDate() - 7);
      setWeekStart(toDateString(d));
    } else {
      if (month === 1) {
        setMonth(12);
        setYear(year - 1);
      } else {
        setMonth(month - 1);
      }
    }
  }, [period, weekStart, month, year]);

  const handleNextPeriod = useCallback(() => {
    if (period === 'weekly') {
      const d = new Date(weekStart + 'T00:00:00');
      d.setDate(d.getDate() + 7);
      // Don't go beyond today
      if (toDateString(d) <= toDateString(today)) {
        setWeekStart(toDateString(d));
      }
    } else {
      if (month === 12) {
        setMonth(1);
        setYear(Math.min(2035, year + 1));
      } else {
        setMonth(month + 1);
      }
    }
  }, [period, weekStart, month, year, today]);

  const isCurrent =
    period === 'weekly'
      ? weekStart === defaultWeekStart
      : year === defaultYear && month === defaultMonth;

  const yearOptions = useMemo(() => {
    const arr: number[] = [];
    for (let y = 2020; y <= 2035; y++) arr.push(y);
    return arr;
  }, []);

  const monthOptions = useMemo(() => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">学习报告</h1>
        <p className="mt-1 text-slate-500">查看每周 / 每月的学习统计与趋势</p>
      </div>

      {/* Period selector */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setPeriod('weekly')}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                  period === 'weekly'
                    ? 'bg-white text-primary-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                周报
              </button>
              <button
                type="button"
                onClick={() => setPeriod('monthly')}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                  period === 'monthly'
                    ? 'bg-white text-primary-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                月报
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={handlePrevPeriod}>
                ←
              </Button>
              <Button variant="outline" size="sm" onClick={handleNextPeriod} disabled={isCurrent}>
                →
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {period === 'weekly' ? (
              <input
                type="date"
                value={weekStart}
                max={toDateString(today)}
                onChange={(e) => setWeekStart(e.target.value)}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            ) : (
              <>
                <select
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-200"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y} 年
                    </option>
                  ))}
                </select>
                <select
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-200"
                >
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {m} 月
                    </option>
                  ))}
                </select>
              </>
            )}
            <Button variant="outline" size="sm" onClick={() => void loadReport()}>
              刷新
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">导出：</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleExport('learning_records')}
            loading={exporting === 'learning_records'}
            disabled={exporting !== null}
          >
            📄 学习记录 CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleExport('word_mastery')}
            loading={exporting === 'word_mastery'}
            disabled={exporting !== null}
          >
            📚 词汇掌握度 CSV
          </Button>
        </div>
      </Card>

      {error ? (
        <div className="rounded-lg border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700">
          加载失败：{error}
        </div>
      ) : null}

      {loading ? (
        <PageLoader message="正在生成报告…" />
      ) : period === 'weekly' ? (
        weekly ? (
          <WeeklyReport report={weekly} />
        ) : (
          <EmptyReport />
        )
      ) : monthly ? (
        <MonthlyReport report={monthly} />
      ) : (
        <EmptyReport />
      )}
    </div>
  );
}

function EmptyReport() {
  return (
    <Card className="p-10">
      <div className="flex flex-col items-center gap-2 text-center text-slate-400">
        <span className="text-5xl">📊</span>
        <p className="text-sm">暂无数据</p>
        <p className="text-xs">该周期内还没有学习记录</p>
      </div>
    </Card>
  );
}

function WeeklyReport({ report }: { report: WeeklyReportView }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {formatWeekStart(report.weekStart)} ~ {formatWeekStart(report.weekEnd)}
          </h2>
          <p className="text-sm text-slate-500">
            周平均得分 {report.avgDailyScore.toFixed(1)} · 整体正确率 {(report.correctRate * 100).toFixed(0)}%
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="学习时长" value={`${report.totalStudyMinutes} 分钟`} icon="⏱️" accent="primary" />
        <StatCard label="新学词汇" value={report.totalNewWords} icon="📚" accent="info" />
        <StatCard label="复习次数" value={report.totalReviews} icon="🔁" accent="success" />
        <StatCard label="错题数" value={report.totalErrors} icon="⚠️" accent="warning" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <CardHeader title="每日明细" subtitle="7 天学习情况" />
          {report.dailyBreakdown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-slate-400">
              <span className="text-4xl">📅</span>
              <p className="text-sm">本周暂无明细数据</p>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">日期</th>
                    <th className="px-3 py-2 text-right">学习时长</th>
                    <th className="px-3 py-2 text-right">新学</th>
                    <th className="px-3 py-2 text-right">复习</th>
                    <th className="px-3 py-2 text-right">平均分</th>
                    <th className="px-3 py-2 text-right">正确率</th>
                  </tr>
                </thead>
                <tbody>
                  {report.dailyBreakdown.map((d) => (
                    <tr key={d.date} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-slate-800">{formatDate(d.date)}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">{d.studyMinutes} 分</td>
                      <td className="px-3 py-2.5 text-right">{d.newWords}</td>
                      <td className="px-3 py-2.5 text-right">{d.reviews}</td>
                      <td className="px-3 py-2.5 text-right">{d.avgScore.toFixed(1)}</td>
                      <td className="px-3 py-2.5 text-right">{(d.correctRate * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <CardHeader title="掌握度 TOP 5" subtitle="本周掌握最好的词汇" />
          {report.topMasteryWords.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-slate-400">
              <span className="text-4xl">🏆</span>
              <p className="text-sm">暂无词汇数据</p>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {report.topMasteryWords.map((w, i) => (
                <li
                  key={w.wordId}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-bold text-primary-600">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm text-slate-700">词汇 #{w.wordId}</span>
                  <Badge variant="success">{(w.overallScore * 100).toFixed(0)}%</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function MonthlyReport({ report }: { report: MonthlyReportView }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          {report.year} 年 {report.month} 月
        </h2>
        <p className="text-sm text-slate-500">
          月平均得分 {report.avgDailyScore.toFixed(1)} · 整体正确率 {(report.correctRate * 100).toFixed(0)}%
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="学习时长" value={`${report.totalStudyMinutes} 分`} icon="⏱️" accent="primary" />
        <StatCard label="新学词汇" value={report.totalNewWords} icon="📚" accent="info" />
        <StatCard label="复习次数" value={report.totalReviews} icon="🔁" accent="success" />
        <StatCard label="学习天数" value={report.studyDays} icon="📅" accent="warning" />
        <StatCard label="最长连击" value={`${report.longestStreak} 天`} icon="🔥" accent="danger" />
      </div>

      <Card className="p-5">
        <CardHeader title="每周明细" subtitle="按周汇总学习数据" />
        {report.weeklyBreakdown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-slate-400">
            <span className="text-4xl">📅</span>
            <p className="text-sm">本月暂无明细数据</p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">周期</th>
                  <th className="px-3 py-2 text-right">学习时长</th>
                  <th className="px-3 py-2 text-right">新学</th>
                  <th className="px-3 py-2 text-right">复习</th>
                </tr>
              </thead>
              <tbody>
                {report.weeklyBreakdown.map((w) => (
                  <tr key={w.weekStart} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-slate-800">{formatDate(w.weekStart)} 起</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">{w.studyMinutes} 分</td>
                    <td className="px-3 py-2.5 text-right">{w.newWords}</td>
                    <td className="px-3 py-2.5 text-right">{w.reviews}</td>
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
