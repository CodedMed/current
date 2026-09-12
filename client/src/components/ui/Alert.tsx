import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<AlertTone, { wrap: string; icon: typeof Info; iconClass: string }> = {
  info: { wrap: 'bg-brand-50 text-brand-900 ring-brand-200', icon: Info, iconClass: 'text-brand-600' },
  success: { wrap: 'bg-positive-50 text-positive-700 ring-positive-100', icon: CircleCheck, iconClass: 'text-positive-600' },
  warning: { wrap: 'bg-warning-50 text-warning-700 ring-warning-100', icon: TriangleAlert, iconClass: 'text-warning-600' },
  danger: { wrap: 'bg-danger-50 text-danger-700 ring-danger-100', icon: CircleAlert, iconClass: 'text-danger-600' },
};

export interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function Alert({ tone = 'info', title, children, action, className }: AlertProps) {
  const t = TONES[tone];
  const Icon = t.icon;
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-xl p-4 ring-1 ring-inset', t.wrap, className)}>
      <Icon className={cn('mt-0.5 size-5 shrink-0', t.iconClass)} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'opacity-90')}>{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}
