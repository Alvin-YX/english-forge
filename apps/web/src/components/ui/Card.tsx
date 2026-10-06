import type { HTMLAttributes, ReactNode } from 'react';

import type { TrendDirection } from '../../lib/types';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  interactive?: boolean;
}

export function Card({ children, className = '', interactive = false, ...rest }: CardProps) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-[var(--shadow-card)] ${interactive ? 'cursor-pointer hover:border-primary-300 hover:shadow-[var(--shadow-elevated)] transition-all' : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}

export function CardHeader({ title, subtitle, action, className = '', ...rest }: CardHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-4 px-5 py-4 ${className}`} {...rest}>
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold text-slate-900">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  trend?: TrendDirection;
  trendValue?: string;
  hint?: string;
  accent?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
}

const accentBg: Record<NonNullable<StatCardProps['accent']>, string> = {
  primary: 'bg-primary-100 text-primary-700',
  success: 'bg-success-50 text-success-600',
  warning: 'bg-warning-50 text-warning-600',
  danger: 'bg-danger-50 text-danger-600',
  info: 'bg-info-50 text-info-600',
};

export function StatCard({
  label,
  value,
  icon,
  trend,
  trendValue,
  hint,
  accent = 'primary',
}: StatCardProps) {
  const trendColor =
    trend === 'up'
      ? 'text-success-600'
      : trend === 'down'
        ? 'text-danger-600'
        : 'text-slate-500';
  const trendSymbol = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '·';

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1 truncate text-2xl font-bold text-slate-900">{value}</p>
          {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
        </div>
        {icon ? (
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${accentBg[accent]}`}>
            {icon}
          </div>
        ) : null}
      </div>
      {trendValue ? (
        <p className={`mt-3 text-xs font-medium ${trendColor}`}>
          {trendSymbol} {trendValue}
        </p>
      ) : null}
    </Card>
  );
}
