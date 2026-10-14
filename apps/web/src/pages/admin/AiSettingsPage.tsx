import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import { PageLoader } from '../../components/common/PageLoader';
import { RequireRole } from '../../components/common/RequireRole';
import { StateView } from '../../components/common/StateView';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { api } from '../../lib/api';
import type { LlmProvider, LlmPresetsView, LlmTestResult } from '../../lib/types';
import { useAuthStore } from '../../stores/auth';

/** 表单本地态；`apiKey === null` 表示「沿用已保存的 Key」 */
interface LlmForm {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: string;
}

/** `GET /system/llm` 中本页面真正用到的字段 */
interface LlmConfigState {
  model: string;
  baseUrl: string;
  timeoutMs: string;
  hasKey: boolean;
  keyHint: string | null;
  updatedAt: string | null;
  hasMasterKey: boolean;
  masterKeyHint?: string;
}

interface Notice {
  tone: 'ok' | 'err';
  text: string;
}

/** 组装请求体：Key 为空就不带该字段，后端据此沿用已保存的 Key */
function buildLlmPayload(form: LlmForm) {
  const trimmed = form.apiKey?.trim();
  return {
    provider: form.provider,
    model: form.model.trim(),
    baseUrl: form.baseUrl.trim(),
    timeoutMs: Number(form.timeoutMs),
    ...(trimmed ? { apiKey: trimmed } : {}),
  };
}

function initialForm(presets: LlmPresetsView | null): LlmForm {
  return {
    provider: 'openai',
    model: presets?.presets.openai?.model ?? '',
    baseUrl: presets?.presets.openai?.baseUrl ?? '',
    apiKey: null,
    timeoutMs: String(presets?.timeoutDefaultMs ?? 12000),
  };
}

export function AiSettingsPage() {
  const role = useAuthStore((s) => s.user?.role);

  const [presets, setPresets] = useState<LlmPresetsView | null>(null);
  const [config, setConfig] = useState<LlmConfigState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<LlmForm>(() => initialForm(null));
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 预设与当前配置并行取：两者都是只读，无依赖关系
        const [p, c] = await Promise.all([
          api.get<LlmPresetsView>('/system/llm/presets'),
          api.get<LlmConfigState>('/system/llm'),
        ]);
        if (cancelled) return;
        setPresets(p);
        setConfig({
          model: c.model ?? '',
          baseUrl: c.baseUrl ?? '',
          timeoutMs: String(c.timeoutMs ?? 12000),
          hasKey: c.hasKey,
          keyHint: c.keyHint,
          updatedAt: c.updatedAt,
          hasMasterKey: c.hasMasterKey,
          masterKeyHint: c.masterKeyHint,
        });
        setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : '读取配置失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 拉到服务端配置后把表单填上（config 只在成功加载时被赋值一次） */
  useEffect(() => {
    if (!config) return;
    setForm((prev) => ({
      provider: prev.provider,
      model: config.model,
      baseUrl: config.baseUrl,
      apiKey: null,
      timeoutMs: config.timeoutMs,
    }));
  }, [config]);

  function applyPreset(provider: LlmProvider) {
    const preset = presets?.presets[provider];
    if (!preset) return;
    // `custom` 不清默认值：自定义端点没有「标准答案」，清空逼用户显式填写
    setForm((prev) => ({
      ...prev,
      provider,
      model: provider === 'custom' ? '' : preset.model,
      baseUrl: provider === 'custom' ? '' : preset.baseUrl,
    }));
  }

  const handleSave = useCallback(async () => {
    if (saving) return;
    if (!form.model.trim()) {
      setNotice({ tone: 'err', text: '请填写模型名' });
      return;
    }
    if (!form.baseUrl.trim()) {
      setNotice({ tone: 'err', text: '请填写 base_url' });
      return;
    }
    const payload = buildLlmPayload(form);
    setSaving(true);
    setNotice(null);
    try {
      const saved = await api.post<{ hasKey: boolean; keyHint: string | null }>('/system/llm', payload);
      setConfig((prev) =>
        prev ? { ...prev, hasKey: saved.hasKey, keyHint: saved.keyHint ?? prev.keyHint } : prev,
      );
      setNotice({ tone: 'ok', text: '配置已保存' });
    } catch (err) {
      setNotice({ tone: 'err', text: err instanceof Error ? err.message : '保存失败' });
    } finally {
      setSaving(false);
    }
  }, [saving, form]);

  const handleTest = useCallback(async () => {
    if (testing) return;
    const payload = buildLlmPayload(form);
    setTesting(true);
    setTestResult(null);
    setNotice(null);
    try {
      const result = await api.post<LlmTestResult>('/system/llm/test', payload);
      setTestResult(result);
      if (result.ok) {
        setNotice({
          tone: 'ok',
          text: `连通性正常：${result.model ?? form.model} 响应 ${result.latencyMs ?? 0}ms`,
        });
      }
    } catch (err) {
      // 后端约定 test 永不抛错；这里兜的是网络层异常
      setTestResult({ ok: false, error: err instanceof Error ? err.message : '测试请求失败' });
    } finally {
      setTesting(false);
    }
  }, [testing, form]);

  const body = loadError ? (
    <Card>
      <StateView title="无法读取 AI 配置" message={loadError} />
    </Card>
  ) : !config || !presets ? (
    <PageLoader message="正在加载 AI 配置…" />
  ) : (
    <LlmConfigForm
      presets={presets}
      config={config}
      form={form}
      setForm={setForm}
      applyPreset={applyPreset}
      handleSave={handleSave}
      handleTest={handleTest}
      notice={notice}
      testResult={testResult}
      saving={saving}
      testing={testing}
    />
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">AI 设置 🔌</h1>
        <p className="mt-1 text-slate-500">配置第三方大模型，让「AI 对话」页真正回复</p>
      </div>

      <RequireRole
        userRole={role}
        allowed={['admin']}
        fallbackTitle="该页面仅管理员可用"
        fallbackMessage="当前账号不是管理员。请登录管理员账号后访问。"
      >
        {body}

        {config && config.hasMasterKey ? null : (
          <div className="rounded-xl border border-warning-200 bg-warning-50 p-4 text-sm leading-6 text-warning-800">
            <p className="font-semibold">⚠️ 服务器尚未配置主密钥，API Key 无法加密保存</p>
            <p className="mt-1 whitespace-pre-wrap break-all font-mono text-xs">
              {config?.masterKeyHint ?? '请配置环境变量 APP_SECRET_MASTER_KEY 后重启服务'}
            </p>
          </div>
        )}

        {config ? (
          <p className="text-xs leading-5 text-slate-400">
            API Key 仅以 AES-256-GCM 密文存于数据库（<code>app_secret</code>），任何接口都不返回明文。
            保存密钥依赖服务器环境变量 <code>APP_SECRET_MASTER_KEY</code> —— 该主密钥一旦丢失，
            已存密钥将永久无法解密，请与数据库备份一起保管。
          </p>
        ) : null}
      </RequireRole>
    </div>
  );
}

interface LlmConfigFormProps {
  presets: LlmPresetsView;
  config: LlmConfigState;
  form: LlmForm;
  setForm: Dispatch<SetStateAction<LlmForm>>;
  applyPreset: (provider: LlmProvider) => void;
  handleSave: () => void;
  handleTest: () => void;
  notice: Notice | null;
  testResult: LlmTestResult | null;
  saving: boolean;
  testing: boolean;
}

function LlmConfigForm({
  presets,
  config,
  form,
  setForm,
  applyPreset,
  handleSave,
  handleTest,
  notice,
  testResult,
  saving,
  testing,
}: LlmConfigFormProps) {
  const keyPlaceholder = config.keyHint
    ? `已设置（${config.keyHint}），留空保持不变`
    : '请输入 API Key';

  return (
    <Card>
      <CardHeader
        title="大模型接入"
        subtitle="base_url + 模型名 + API Key 三件套覆盖全部 OpenAI 兼容服务"
        action={
          config.hasKey ? <Badge variant="success">已配置 Key</Badge> : <Badge variant="outline">未设置 Key</Badge>
        }
      />
      <div className="px-5 pb-5">
        <div className="mb-5">
          <p className="mb-2 text-sm font-medium text-slate-700">供应商预设</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(presets.presets) as LlmProvider[]).map((key) => {
              const preset = presets.presets[key];
              if (!preset) return null;
              const active = form.provider === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPreset(key)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                    active
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Base URL"
            value={form.baseUrl}
            onChange={(e) => setForm((p) => ({ ...p, baseUrl: e.target.value }))}
            placeholder="https://api.deepseek.com/v1"
            hint="OpenAI 兼容端点，通常以 /v1 结尾"
          />
          <Input
            label="模型名"
            value={form.model}
            onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
            placeholder="deepseek-chat"
            maxLength={64}
          />
          <Input
            label="API Key"
            type="password"
            autoComplete="off"
            value={form.apiKey ?? ''}
            onChange={(e) => setForm((p) => ({ ...p, apiKey: e.target.value }))}
            placeholder={keyPlaceholder}
            hint={config.hasKey ? '留空表示沿用当前已保存的 Key' : '首次保存必填'}
          />
          <Input
            label="超时（毫秒）"
            type="number"
            min={presets.timeoutMinMs}
            max={presets.timeoutMaxMs}
            value={form.timeoutMs}
            onChange={(e) => setForm((p) => ({ ...p, timeoutMs: e.target.value }))}
            hint={`${presets.timeoutMinMs} – ${presets.timeoutMaxMs}ms，越界按边界截断`}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} loading={saving}>
            保存配置
          </Button>
          <Button variant="secondary" onClick={handleTest} loading={testing}>
            连通性测试
          </Button>
          <span className="text-xs text-slate-400">
            {config.updatedAt
              ? `上次保存 ${new Date(config.updatedAt).toLocaleString('zh-CN')}`
              : '尚未保存过'}
          </span>
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

        {testResult ? (
          <div
            className={`mt-4 rounded-lg border p-3 text-sm ${
              testResult.ok
                ? 'border-success-200 bg-success-50 text-success-700'
                : 'border-danger-200 bg-danger-50 text-danger-700'
            }`}
          >
            <p className="font-medium">
              {testResult.ok ? '✅ 连通性测试通过' : '❌ 连通性测试失败'}
            </p>
            {testResult.ok ? (
              <p className="mt-1 text-xs">
                {testResult.model ?? '模型'} · {testResult.latencyMs ?? 0}ms
                {typeof testResult.totalTokens === 'number' ? ` · ${testResult.totalTokens} tokens` : ''}
              </p>
            ) : (
              <p className="mt-1">{testResult.error ?? '原因未知'}</p>
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
