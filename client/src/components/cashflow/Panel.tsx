import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

interface PanelProps {
  id?: string;
  title: string;
  subtitle?: ReactNode;
  aside?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/** Section chrome shared by every dashboard module. */
export function Panel({ id, title, subtitle, aside, footer, children, className, bodyClassName }: PanelProps) {
  return (
    <section id={id} className={cn('flex min-w-0 flex-col rounded-2xl bg-panel shadow-card ring-1 ring-ink/5 scroll-mt-52 lg:scroll-mt-36', className)} aria-label={title}>
      <header className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </header>
      <div className={cn('flex-1 px-5 pt-4 pb-5 sm:px-6 sm:pb-6', bodyClassName)}>{children}</div>
      {footer && <footer className="border-t border-line px-5 py-3.5 sm:px-6">{footer}</footer>}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-ink-muted">{children}</p>;
}
