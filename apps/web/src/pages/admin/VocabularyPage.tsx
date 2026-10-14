import { useEffect, useState } from 'react';

import { PageLoader } from '../../components/common/PageLoader';
import { RequireRole } from '../../components/common/RequireRole';
import { StateView } from '../../components/common/StateView';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { api } from '../../lib/api';
import type { AdminWordView, WordImportResult, WordActiveResult } from '../../lib/types';
import { useAuthStore } from '../../stores/auth';

const PAGE_SIZE = 20;
const MAX_BATCH = 500;

const POS_OPTIONS = ['', 'n.', 'v.', 'adj.', 'adv.', 'prep.', 'conj.', 'pron.', 'num.', 'int.'];
const BAND_OPTIONS = ['', '超高', '高', '中', '低'];
const CEFR_OPTIONS = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

interface FilterState {
  search: string;
  pos: string;
  frequencyBand: string;
  cefrLevel: string;
  includeInactive: boolean;
  sortDir: 'asc' | 'desc';
}

const DEFAULT_FILTERS: FilterState = {
  search: '',
  pos: '',
  frequencyBand: '',
  cefrLevel: '',
  includeInactive: false,
  sortDir: 'asc',
};

interface Notice {
  tone: 'ok' | 'err';
  text: string;
}

function buildQuery(filters: FilterState, page: number) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.pos) params.set('pos', filters.pos);
  if (filters.frequencyBand) params.set('frequencyBand', filters.frequencyBand);
  if (filters.cefrLevel) params.set('cefrLevel', filters.cefrLevel);
  if (filters.includeInactive) params.set('includeInactive', 'true');
  if (filters.sortDir !== 'asc') params.set('sortDir', 'desc');
  params.set('sortBy', 'frequency');
  return `/words-admin?${params.toString()}`;
}

export function VocabularyPage() {
  const role = useAuthStore((s) => s.user?.role);

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AdminWordView[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [busyId, setBusyId] = useState<number | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  // ── 导入表单 ─────────────────────────────────────────────
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLicense, setImportLicense] = useState('');
  const [importAsInactive, setImportAsInactive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<WordImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  /** 搜索词防抖：避免每敲一个字符都打一次接口 */
  useEffect(() => {
    const timer = setTimeout(() => setPage(1), 300);
    return () => clearTimeout(timer);
  }, [filters.search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<{ items: AdminWordView[]; total: number; totalPages: number }>(buildQuery(filters, page))
      .then((res) => {
        if (cancelled) return;
        setRows(Array.isArray(res.items) ? res.items : []);
        setTotal(res.total ?? 0);
        setTotalPages(res.totalPages ?? 1);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载词条失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, page]);

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) {
        for (const row of rows) next.delete(row.id);
      } else {
        for (const row of rows) next.add(row.id);
      }
      return next;
    });
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function setActive(ids: number[], isActive: boolean) {
    if (ids.length === 0) return;
    setNotice(null);
    if (!isActive) {
      const countText = ids.length === 1 ? '这条' : `这 ${ids.length} 条`;
      if (
        !window.confirm(
          `确定停用${countText}词条？停用的词会立刻从公开词库、练习出题和默写判分中消失。`,
        )
      ) {
        return;
      }
    }

    if (ids.length > MAX_BATCH) {
      setNotice({ tone: 'err', text: `单次最多 ${MAX_BATCH} 条，本次未执行任何操作` });
      return;
    }

    if (ids.length === 1) {
      setBusyId(ids[0] ?? null);
    } else {
      setBatchBusy(true);
    }
    try {
      const result: WordActiveResult =
        ids.length === 1
          ? await api.patch(`/words-admin/${ids[0]}/active`, { isActive })
          : await api.post('/words-admin/batch-active', { ids, isActive });
      setNotice({
        tone: 'ok',
        text: `${isActive ? '已恢复' : '已停用'} ${result.updated} 条词条`,
      });
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      void load();
    } catch (err) {
      setNotice({ tone: 'err', text: err instanceof Error ? err.message : '操作失败' });
    } finally {
      setBusyId(null);
      setBatchBusy(false);
    }
  }

  /** 重新拉当前页（停用后行内状态要跟着变） */
  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ items: AdminWordView[]; total: number; totalPages: number }>(
        buildQuery(filters, page),
      );
      setRows(Array.isArray(res.items) ? res.items : []);
      setTotal(res.total ?? 0);
      setTotalPages(res.totalPages ?? 1);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载词条失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!importFile || importing) return;
    if (!importLicense.trim()) {
      setImportError('许可标识必填（如 ecdict-1.0、cc-by-4.0）—— 词条库的版权红线');
      return;
    }

    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', importFile);
      fd.append('license', importLicense.trim());
      fd.append('importAsInactive', importAsInactive ? 'true' : 'false');
      const result = await api.upload<WordImportResult>('/words-admin/import', fd);
      setImportResult(result);
      setImportFile(null);
      setImportLicense('');
      setImportAsInactive(false);
      void load();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImporting(false);
    }
  }

  const body = loading && rows.length === 0 && !error ? (
    <PageLoader message="正在加载词库…" />
  ) : error ? (
    <Card>
      <StateView title="无法加载词库" message={error} />
    </Card>
  ) : (
    <>
      <Card>
        <CardHeader
          title="词条筛选"
          subtitle={`共 ${total} 条词条`}
          action={
            <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
              ＋ 导入 CSV
            </Button>
          }
        />
        <div className="px-5 pb-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="col-span-2">
              <Input
                label="搜索"
                value={filters.search}
                onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
                placeholder="单词、词元或释义"
                prefix="🔍"
              />
            </div>
            <SelectField
              label="词性"
              value={filters.pos}
              options={POS_OPTIONS}
              onChange={(v) => setFilters((p) => ({ ...p, pos: v }))}
            />
            <SelectField
              label="词频"
              value={filters.frequencyBand}
              options={BAND_OPTIONS}
              onChange={(v) => setFilters((p) => ({ ...p, frequencyBand: v }))}
            />
            <SelectField
              label="CEFR"
              value={filters.cefrLevel}
              options={CEFR_OPTIONS}
              onChange={(v) => setFilters((p) => ({ ...p, cefrLevel: v }))}
            />
            <SelectField
              label="排序"
              value={filters.sortDir}
              options={[
                ['asc', 'A→Z'],
                ['desc', 'Z→A'],
              ]}
              onChange={(v) => setFilters((p) => ({ ...p, sortDir: v as 'asc' | 'desc' }))}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={filters.includeInactive}
                onChange={(e) => setFilters((p) => ({ ...p, includeInactive: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300"
              />
              包含已停用词条
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                disabled={rows.length === 0}
                className="h-4 w-4 rounded border-slate-300"
              />
              全选本页
            </label>
            <span className="text-xs text-slate-400">已选 {selected.size} 条</span>
            {selected.size > 0 ? (
              <span className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={batchBusy}
                  loading={batchBusy}
                  onClick={() => void setActive([...selected], false)}
                >
                  停用所选
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={batchBusy}
                  onClick={() => void setActive([...selected], true)}
                >
                  恢复所选
                </Button>
              </span>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFilters(DEFAULT_FILTERS);
                setPage(1);
              }}
            >
              重置
            </Button>
          </div>

          {notice ? (
            <p
              className={`mt-4 text-sm font-medium ${
                notice.tone === 'ok' ? 'text-success-600' : 'text-danger-600'
              }`}
            >
              {notice.text}
            </p>
          ) : null}
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">单词</th>
                <th className="px-3 py-2">释义</th>
                <th className="px-3 py-2">词性</th>
                <th className="px-3 py-2">CEFR</th>
                <th className="px-3 py-2">词频</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr
                  key={w.id}
                  className={`border-b border-slate-100 ${w.isActive ? '' : 'bg-slate-50'}`}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected.has(w.id)}
                        onChange={() => toggleOne(w.id)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <span className="font-semibold text-slate-800">{w.headword}</span>
                      {w.phoneticUk || w.phoneticUs ? (
                        <span className="text-xs text-slate-400">
                          {w.phoneticUk ?? w.phoneticUs}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="max-w-64 truncate px-3 py-2.5 text-slate-600">
                    {w.translationZh}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{w.pos ?? '—'}</td>
                  <td className="px-3 py-2.5 text-slate-500">{w.cefrLevel ?? '—'}</td>
                  <td className="px-3 py-2.5 text-slate-500">{w.frequencyBand ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    {w.isActive ? (
                      <Badge variant="success">启用</Badge>
                    ) : (
                      <Badge variant="outline">已停用</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Button
                      size="sm"
                      variant={w.isActive ? 'danger' : 'outline'}
                      loading={busyId === w.id}
                      disabled={busyId !== null && busyId !== w.id}
                      onClick={() => void setActive([w.id], !w.isActive)}
                    >
                      {w.isActive ? '停用' : '恢复'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && !loading ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-slate-400">
            <span className="text-4xl">📖</span>
            <p className="text-sm">没有匹配的词条</p>
            <p className="text-xs">调整筛选条件，或点击「导入 CSV」补充词库</p>
          </div>
        ) : null}

        {totalPages > 1 ? (
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm">
            <span className="text-slate-500">
              第 {page} / {totalPages} 页
            </span>
            <span className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </span>
          </div>
        ) : null}
      </Card>
    </>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">词库管理 📚</h1>
        <p className="mt-1 text-slate-500">
          筛选、停用问题词条，或从 CSV 批量补充词库（只读词条无法在此新建/编辑）
        </p>
      </div>

      <RequireRole
        userRole={role}
        allowed={['admin']}
        fallbackTitle="该页面仅管理员可用"
        fallbackMessage="当前账号不是管理员。请登录管理员账号后访问。"
      >
        {body}
      </RequireRole>

      {showImport ? (
        <ImportModal
          onClose={() => !importing && setShowImport(false)}
          importFile={importFile}
          setImportFile={setImportFile}
          importLicense={importLicense}
          setImportLicense={setImportLicense}
          importAsInactive={importAsInactive}
          setImportAsInactive={setImportAsInactive}
          importing={importing}
          importResult={importResult}
          importError={importError}
          onImport={() => void handleImport()}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 子组件
// ─────────────────────────────────────────────────────────────

interface SelectFieldProps {
  label: string;
  value: string;
  options: ReadonlyArray<string | [string, string]>;
  onChange: (value: string) => void;
}

function SelectField({ label, value, options, onChange }: SelectFieldProps) {
  return (
    <div className="w-full">
      <label className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-[var(--radius-btn)] border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
      >
        {options.map((opt) => {
          const [val, text] = Array.isArray(opt) ? opt : [opt, opt === '' ? '全部' : opt];
          return (
            <option key={val || 'all'} value={val}>
              {text}
            </option>
          );
        })}
      </select>
    </div>
  );
}

interface ImportModalProps {
  onClose: () => void;
  importFile: File | null;
  setImportFile: (file: File | null) => void;
  importLicense: string;
  setImportLicense: (value: string) => void;
  importAsInactive: boolean;
  setImportAsInactive: (value: boolean) => void;
  importing: boolean;
  importResult: WordImportResult | null;
  importError: string | null;
  onImport: () => void;
}

const SAMPLE_CSV_HINT =
  'word,phonetic,definition,translation,pos,collins,oxford,tag\necho,"/ˈekəʊ/","to give an opinion","回声","n.",0,"",KET';

function ImportModal({
  onClose,
  importFile,
  setImportFile,
  importLicense,
  setImportLicense,
  importAsInactive,
  setImportAsInactive,
  importing,
  importResult,
  importError,
  onImport,
}: ImportModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <Card className="max-h-[85vh] w-full max-w-2xl overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">导入词库 CSV</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            ECDICT 格式，单次最多 20 000 行；按 (lemma, pos) 幂等，重复行不会重复入库
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">CSV 文件</p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100"
            />
            <p className="mt-1 text-xs text-slate-400">
              {importFile ? `${importFile.name}（${(importFile.size / 1024).toFixed(1)} KB）` : '未选择文件'}
            </p>
          </div>

          <Input
            label="许可标识（必填）"
            value={importLicense}
            onChange={(e) => setImportLicense(e.target.value)}
            placeholder="ecdict-1.0"
            hint="写入每条词条的 license 字段，用于满足版权追溯要求"
          />

          <label className="flex items-start gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={importAsInactive}
              onChange={(e) => setImportAsInactive(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              导入后先停用
              <span className="block text-xs text-slate-400">适合「先上传后审核」的工作流</span>
            </span>
          </label>

          <div className="rounded-lg bg-slate-50 p-3">
            <p className="mb-1 text-xs font-medium text-slate-500">列顺序（第 1–8 列参与映射）</p>
            <p className="overflow-x-auto whitespace-nowrap text-xs text-slate-600">{SAMPLE_CSV_HINT}</p>
          </div>

          {importError ? (
            <p className="rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700">
              {importError}
            </p>
          ) : null}

          {importResult ? (
            <div className="rounded-lg border border-success-200 bg-success-50 p-3 text-sm text-success-700">
              <p className="font-medium">✅ 导入完成</p>
              <p className="mt-1 text-xs">
                共 {importResult.totalRows} 行：新增 {importResult.inserted} ·
                已存在 {importResult.conflicts} · 文件内重复 {importResult.duplicates} ·
                无效 {importResult.invalid}（许可 {importResult.license}）
              </p>
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={importing}>
            关闭
          </Button>
          <Button onClick={onImport} loading={importing} disabled={!importFile || !importLicense.trim()}>
            {importing ? '正在导入…' : '开始导入'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
