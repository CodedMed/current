import { useMemo, useState } from 'react';
import type { Breakdown, BreakdownSlice } from '../../../../shared/types.ts';
import { cn } from '../../lib/cn.ts';
import { compactMoney, money } from '../../lib/format.ts';
import { EmptyState, Panel } from './Panel.tsx';
import { Segmented } from './Segmented.tsx';

type Tab = 'out' | 'in' | 'customers';

const SLOT = ['var(--color-cat-1)', 'var(--color-cat-2)', 'var(--color-cat-3)', 'var(--color-cat-4)', 'var(--color-cat-5)'];
const OTHER = 'var(--color-cat-other)';

interface Props {
  breakdown: Breakdown;
  periodLabel: string;
}

export function BreakdownPanel({ breakdown, periodLabel }: Props) {
  const [tab, setTab] = useState<Tab>('out');
  const [hover, setHover] = useState<number | null>(null);
  const slices = tab === 'out' ? breakdown.cashOut : tab === 'in' ? breakdown.cashIn : breakdown.byCustomer;
  const total = tab === 'out' ? breakdown.totalOut : breakdown.totalIn;
  const colors = useMemo(() => slices.map((s, i) => (s.id === 'other' || s.id === 'other_sources' ? OTHER : (SLOT[i] ?? OTHER))), [slices]);
  const title = tab === 'out' ? 'Cash out breakdown' : tab === 'in' ? 'Cash in breakdown' : 'Cash in by customer';

  return (
    <Panel
      title={title}
      subtitle={periodLabel}
      aside={
        <Segmented
          label="Breakdown"
          size="xs"
          options={[
            { id: 'out', label: 'Cash out' },
            { id: 'in', label: 'Cash in' },
            { id: 'customers', label: 'By customer' },
          ]}
          value={tab}
          onChange={(t) => {
            setTab(t);
            setHover(null);
          }}
        />
      }
      bodyClassName="pt-3"
    >
      {slices.length === 0 ? (
        <EmptyState>No activity in this period.</EmptyState>
      ) : (
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          <Donut slices={slices} colors={colors} total={total} hover={hover} onHover={setHover} label={tab === 'out' ? 'Cash out' : 'Cash in'} />
          <ul className="w-full min-w-0 flex-1 space-y-1" aria-label={`${title} by share`}>
            {slices.map((s, i) => (
              <li
                key={s.id}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                className={cn('flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors', hover === i && 'bg-surface')}
              >
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: colors[i] }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={s.label}>
                  {s.label}
                </span>
                <span className="tabular w-10 shrink-0 text-right text-xs text-ink-muted">{Math.round(s.share * 100)}%</span>
                <span className="tabular w-20 shrink-0 text-right text-sm font-semibold text-ink">{compactMoney(s.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function arcPath(cx: number, cy: number, rOuter: number, rInner: number, start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, rOuter, start);
  const [x1, y1] = polar(cx, cy, rOuter, end);
  const [x2, y2] = polar(cx, cy, rInner, end);
  const [x3, y3] = polar(cx, cy, rInner, start);
  return `M${x0},${y0} A${rOuter},${rOuter} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${rInner},${rInner} 0 ${large} 0 ${x3},${y3} Z`;
}

function Donut({ slices, colors, total, hover, onHover, label }: { slices: BreakdownSlice[]; colors: string[]; total: number; hover: number | null; onHover: (i: number | null) => void; label: string }) {
  const size = 176;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 84;
  const rInner = 64;
  const gap = 2 / rOuter; // 2px gap between segments
  let angle = -Math.PI / 2;
  const arcs = slices.map((s, i) => {
    const sweep = Math.max(0, s.share * Math.PI * 2 - gap);
    const start = angle + gap / 2;
    const end = start + sweep;
    angle += s.share * Math.PI * 2;
    return { i, d: sweep > 0.001 ? arcPath(cx, cy, rOuter, rInner, start, end) : '', color: colors[i] ?? OTHER, slice: s };
  });
  const focused = hover !== null ? slices[hover] : undefined;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label} by share; details listed beside the chart.`} className="shrink-0">
      {arcs.map((a) => (
        <path
          key={a.slice.id}
          d={a.d}
          fill={a.color}
          opacity={hover === null || hover === a.i ? 1 : 0.35}
          onPointerEnter={() => onHover(a.i)}
          onPointerLeave={() => onHover(null)}
          className="transition-opacity"
        />
      ))}
      <text x={cx} y={cy - 6} textAnchor="middle" className="tabular fill-[var(--color-ink)] text-[20px] font-bold">
        {compactMoney(focused ? focused.amount : total)}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" className="fill-[var(--color-ink-muted)] text-[11px] font-medium">
        {focused ? `${Math.round(focused.share * 100)}% · ${truncate(focused.label, 18)}` : `${label} · ${money(total, { compact: true })}`}
      </text>
    </svg>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
