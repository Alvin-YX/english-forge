import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: ReactNode;
  error?: string;
  hint?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, prefix, suffix, className = '', id, ...rest },
  ref,
) {
  const inputId = id ?? (typeof label === 'string' ? `input-${label.replace(/\s+/g, '-')}` : undefined);

  return (
    <div className="w-full">
      {label ? (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-slate-700">
          {label}
        </label>
      ) : null}
      <div className="relative">
        {prefix ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{prefix}</span> : null}
        <input
          id={inputId}
          ref={ref}
          className={`h-10 w-full rounded-[var(--radius-btn)] border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-0 transition ${
            error
              ? 'border-danger-500 focus:ring-danger-200'
              : 'border-slate-300 focus:border-primary-500 focus:ring-primary-200'
          } ${prefix ? 'pl-9' : ''} ${suffix ? 'pr-10' : ''} ${className}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          {...rest}
        />
        {suffix ? <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{suffix}</span> : null}
      </div>
      {error ? (
        <p id={inputId ? `${inputId}-error` : undefined} className="mt-1.5 text-xs text-danger-600">
          {error}
        </p>
      ) : hint ? (
        <p id={inputId ? `${inputId}-hint` : undefined} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
