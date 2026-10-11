import type { ReactNode } from 'react';

import { Button } from '../ui/Button';

export type StateTone = 'error' | 'muted';

interface StateViewProps {
  icon?: string;
  title: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  children?: ReactNode;
  /** error = 服务不可用的告警态；muted = 内容为空的中性态 */
  tone?: StateTone;
  /** 紧凑模式：用于嵌在卡片内的局部状态位 */
  compact?: boolean;
}

export function StateView({
  icon = '⚠️',
  title,
  message,
  onRetry,
  retryLabel = '重试',
  children,
  tone = 'error',
  compact = false,
}: StateViewProps) {
  const compactClasses = compact
    ? `rounded-xl border border-dashed p-5 text-center ${
        tone === 'error'
          ? 'border-danger-200 bg-danger-50/50'
          : 'border-slate-200 bg-slate-50'
      }`
    : 'p-8 text-center';

  return (
    <div className={compactClasses}>
      <p className={compact ? 'text-2xl' : 'text-5xl'}>{icon}</p>
      <p
        className={`mt-3 font-medium text-slate-900 ${
          compact ? 'text-sm' : 'text-base'
        }`}
      >
        {title}
      </p>
      {message ? (
        <p
          className={`mt-1 text-slate-500 ${
            compact ? 'text-xs leading-5' : 'text-sm'
          }`}
        >
          {message}
        </p>
      ) : null}
      {children}
      {onRetry ? (
        <Button
          className={compact ? 'mt-3' : 'mt-6'}
          size="sm"
          variant={tone === 'error' ? 'primary' : 'secondary'}
          onClick={onRetry}
        >
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
