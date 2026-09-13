import type { ReactNode } from 'react';

/** The one-line orientation every workspace page opens with: what this page is, and for when. */
export function PageHeading({ title, children, aside }: { title: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">{title}</h1>
        {children && <p className="mt-1 text-sm text-ink-secondary">{children}</p>}
      </div>
      {aside}
    </div>
  );
}
