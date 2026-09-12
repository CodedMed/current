import { cn } from '../../lib/cn.ts';

/** Same-ramp meter: the track is a lighter step of the fill's own hue. */
export function Meter({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  const tone = clamped < 60 ? 'warning' : 'brand';
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-ink-secondary">{label}</span>
        <span className="tabular font-semibold text-ink">{Math.round(clamped)}%</span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        aria-label={label}
        className={cn('h-2.5 w-full overflow-hidden rounded-full', tone === 'warning' ? 'bg-warning-100' : 'bg-brand-100')}
      >
        <div className={cn('h-full rounded-full transition-[width] duration-700', tone === 'warning' ? 'bg-warning-500' : 'bg-brand-600')} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
