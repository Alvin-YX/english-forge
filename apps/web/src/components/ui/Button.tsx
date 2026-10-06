import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800',
  secondary: 'bg-slate-100 text-slate-800 hover:bg-slate-200',
  outline: 'border border-primary-600 text-primary-700 hover:bg-primary-50',
  ghost: 'text-slate-700 hover:bg-slate-100',
  danger: 'bg-danger-600 text-white hover:bg-danger-700',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  icon,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--radius-btn)] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      disabled={isDisabled}
      {...rest}
    >
      {loading ? <Spinner size="sm" className="border-white/90 border-r-transparent" /> : icon}
      {children}
    </button>
  );
}
