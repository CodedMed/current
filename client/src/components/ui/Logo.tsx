import { cn } from '../../lib/cn.ts';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-navy-900" />
      <path d="M9 8v16" stroke="#93b8fb" strokeWidth="3" strokeLinecap="round" />
      <path d="M9 17c5-1 8-5 13-9" stroke="#60a5fa" strokeWidth="3" strokeLinecap="round" />
      <path d="M9 16c6 0 9 3 14 8" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ tone = 'dark', className }: { tone?: 'dark' | 'light'; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className={cn('text-[17px] font-bold tracking-tight', tone === 'light' ? 'text-white' : 'text-ink')}>Keel</span>
    </span>
  );
}
