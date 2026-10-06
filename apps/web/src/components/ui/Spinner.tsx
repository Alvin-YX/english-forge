import type { HTMLAttributes } from 'react';

export type SpinnerSize = 'sm' | 'md' | 'lg';

const sizeMap: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-10 w-10 border-[3px]',
};

interface SpinnerProps extends HTMLAttributes<HTMLElement> {
  size?: SpinnerSize;
}

export function Spinner({ size = 'md', className = '', ...rest }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="loading"
      className={`inline-block animate-spin rounded-full border-primary-500 border-r-transparent ${sizeMap[size]} ${className}`}
      {...rest}
    />
  );
}
