import type { ReactNode } from 'react';
import type { IntegrationMode } from '../../../../shared/types.ts';
import { cn } from '../../lib/cn.ts';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'navy';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface text-ink-secondary ring-line',
  brand: 'bg-brand-50 text-brand-700 ring-brand-100',
  success: 'bg-positive-50 text-positive-700 ring-positive-100',
  warning: 'bg-warning-50 text-warning-700 ring-warning-100',
  danger: 'bg-danger-50 text-danger-700 ring-danger-100',
  navy: 'bg-navy-900 text-white ring-navy-900',
};

export function Badge({ tone = 'neutral', children, className, title }: { tone?: BadgeTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', TONES[tone], className)}>
      {children}
    </span>
  );
}

/** Shows whether an integration is talking to the real service or a local stand-in. */
export function ModeBadge({ mode, service, className }: { mode: IntegrationMode; service: string; className?: string }) {
  if (mode === 'live') {
    return (
      <Badge tone="success" className={className} title={`${service} is connected with live credentials`}>
        <span className="size-1.5 rounded-full bg-positive-500" aria-hidden="true" />
        Live
      </Badge>
    );
  }
  return (
    <Badge tone="warning" className={className} title={`${service} credentials are not configured; a local sandbox is used`}>
      Sandbox
    </Badge>
  );
}
