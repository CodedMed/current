import { cn } from '../../lib/cn.ts';

/** Animated check used for completed states. */
export function SuccessCheck({ className, tone = 'positive' }: { className?: string; tone?: 'positive' | 'brand' }) {
  const ring = tone === 'positive' ? 'bg-positive-50 text-positive-600' : 'bg-brand-50 text-brand-600';
  return (
    <div className={cn('animate-pop grid size-20 place-items-center rounded-full', ring, className)} aria-hidden="true">
      <svg viewBox="0 0 48 48" className="size-11" fill="none">
        <circle cx="24" cy="24" r="21" stroke="currentColor" strokeWidth="2.5" className="opacity-25" />
        <path
          d="M14 25.5 21 32 34 17"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="60"
          className="animate-draw"
        />
      </svg>
    </div>
  );
}
