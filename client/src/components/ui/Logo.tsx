import { cn } from '../../lib/cn.ts';

/**
 * The mark is a tilde: one wave, drawn in `currentColor` so it reads on the light app surface and
 * on the dark onboarding panel without a second copy.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden="true">
      <path
        d="M5 19c3.2-7.6 6.4-7.6 9.6 0s6.4 7.6 9.6 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ tone = 'dark', className }: { tone?: 'dark' | 'light'; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', tone === 'light' ? 'text-white' : 'text-brand-600', className)}>
      <LogoMark className="size-7 shrink-0" />
      <span className={cn('truncate text-[17px] font-bold tracking-tight', tone === 'light' ? 'text-white' : 'text-ink')}>current.surf</span>
    </span>
  );
}
