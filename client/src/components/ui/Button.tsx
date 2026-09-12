import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';
import { Spinner } from './Spinner.tsx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'dark' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap select-none transition-[background-color,border-color,color,box-shadow,transform] duration-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white shadow-sm shadow-brand-600/25 hover:bg-brand-700 disabled:hover:bg-brand-600',
  secondary: 'bg-panel text-ink ring-1 ring-inset ring-line-strong hover:bg-surface hover:ring-ink-muted/60',
  ghost: 'bg-transparent text-ink-secondary hover:bg-ink/5 hover:text-ink',
  dark: 'bg-navy-900 text-white hover:bg-navy-800',
  danger: 'bg-danger-600 text-white hover:bg-danger-700',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm rounded-lg',
  md: 'h-11 px-4 text-sm rounded-xl',
  lg: 'h-12 px-5 text-[15px] rounded-xl',
};

export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', full = false, className?: string): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], full && 'w-full', className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  full?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  full = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, full, className)}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      <span>{children}</span>
      {!loading && iconRight}
    </button>
  );
}
