import { cn } from '../../lib/cn.ts';

const COLORS: Record<string, string> = {
  chase: 'bg-[#0f4fa8] text-white',
  bofa: 'bg-[#c8102e] text-white',
  wells: 'bg-[#b71c1c] text-[#ffd54f]',
  capitalone: 'bg-[#004977] text-white',
  mercury: 'bg-navy-900 text-white',
  stripe: 'bg-[#635bff] text-white',
  paypal: 'bg-[#003087] text-white',
  bluevine: 'bg-[#0b57d0] text-white',
  fundingcircle: 'bg-[#0f8a5f] text-white',
  amex: 'bg-[#006fcf] text-white',
  brex: 'bg-[#1d1d1f] text-white',
  truist: 'bg-[#5b2d8e] text-white',
};

export function monogram(name: string, fallback: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return letters || fallback.slice(0, 2).toUpperCase();
}

/** Two-letter mark in the institution's colour, used wherever a bank or lender is listed. */
export function InstitutionMark({ id, name, size = 'md', className }: { id: string; name: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-lg font-bold tracking-wide',
        size === 'lg' ? 'size-11 text-xs' : size === 'sm' ? 'size-7 text-[10px]' : 'size-9 text-[11px]',
        COLORS[id] ?? 'bg-navy-900 text-white',
        className,
      )}
      aria-hidden="true"
    >
      {monogram(name, id)}
    </span>
  );
}
