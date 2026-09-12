import { useMemo, useState } from 'react';
import type { MonthlyFlow, ResolvedPeriod } from '../../../../shared/types.ts';
import { useElementWidth } from '../../hooks/useElementWidth.ts';
import { cn } from '../../lib/cn.ts';
import { compactMoney, money, signedMoney } from '../../lib/format.ts';
import { ChartCard, LegendSwatch } from '../charts/ChartCard.tsx';
import { niceTicks, roundedTopRect, scale } from '../charts/chartUtils.ts';
import { ChartTooltip, TooltipRow } from '../charts/Tooltip.tsx';

const IN = '#2a78d6';
const OUT = '#eb6834';
const HEIGHT = 240;
const MARGIN = { top: 20, right: 8, bottom: 34, left: 54 };
const MAX_BAR = 28;
const GAP = 2;

interface Props {
  months: MonthlyFlow[];
  period: ResolvedPeriod;
  cashIn: number;
  cashOut: number;
}

export function MonthlyFlowChart({ months, period, cashIn, cashOut }: Props) {
  const net = cashIn - cashOut;
  return (
    <ChartCard
      title="Cash in vs cash out"
      subtitle="Monthly, last 6 months"
      legend={
        <span className="hidden items-center gap-3 sm:flex">
          <LegendSwatch color={IN} label="Cash in" />
          <LegendSwatch color={OUT} label="Cash out" />
        </span>
      }
      table={{
        columns: ['Month', 'Cash in', 'Cash out', 'Net'],
        rows: months.map((m) => [`${m.label}${m.partial ? ' (to date)' : ''}`, money(m.cashIn), money(m.cashOut), signedMoney(m.cashIn - m.cashOut)]),
      }}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_168px]">
        <Bars months={months} />
        <dl className="grid grid-cols-3 gap-3 border-t border-line pt-4 lg:grid-cols-1 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
          <div className="lg:mb-1">
            <p className="text-xs font-semibold text-ink-secondary">{period.label}</p>
          </div>
          <Figure label="Cash in" value={money(cashIn)} />
          <Figure label="Cash out" value={money(cashOut)} />
          <Figure label="Net" value={signedMoney(net)} tone={net > 0 ? 'positive' : net < 0 ? 'negative' : 'neutral'} />
        </dl>
      </div>
    </ChartCard>
  );
}

function Figure({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'positive' | 'negative' | 'neutral' }) {
  return (
    <div className="col-span-1">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={cn('tabular text-[15px] font-bold', tone === 'positive' ? 'text-positive-700' : tone === 'negative' ? 'text-danger-700' : 'text-ink')}>{value}</dd>
    </div>
  );
}

function Bars({ months }: { months: MonthlyFlow[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const plotW = Math.max(120, width - MARGIN.left - MARGIN.right);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const n = Math.max(1, months.length);
  const groupW = plotW / n;
  const barW = Math.min(MAX_BAR, Math.max(8, (groupW - 14 - GAP) / 2));

  const { y, ticks } = useMemo(() => {
    const max = Math.max(1, ...months.flatMap((m) => [m.cashIn, m.cashOut]));
    const t = niceTicks(0, max * 1.08, 5);
    return { ticks: t, y: scale([0, t[t.length - 1] as number], [MARGIN.top + plotH, MARGIN.top]) };
  }, [months, plotH]);
  const baseline = y(0);
  const hovered = hover !== null ? months[hover] : undefined;

  return (
    <div ref={ref} className="relative w-full min-w-0 overflow-hidden">
      <svg width={width} height={HEIGHT} role="img" aria-label={`Monthly cash in and cash out for the last ${months.length} months. Use the table view for exact values.`} className="block select-none" onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--color-viz-axis)' : 'var(--color-viz-grid)'} strokeWidth="1" />
            <text x={MARGIN.left - 8} y={y(t)} dy="0.35em" textAnchor="end" className="tabular fill-[var(--color-viz-muted)] text-[11px]">
              {compactMoney(t)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const gx = MARGIN.left + i * groupW;
          const center = gx + groupW / 2;
          const xIn = center - barW - GAP / 2;
          const xOut = center + GAP / 2;
          const dim = hover !== null && hover !== i;
          return (
            <g key={m.month} opacity={dim ? 0.5 : 1} className="transition-opacity">
              <path d={roundedTopRect(xIn, y(m.cashIn), barW, baseline - y(m.cashIn), 4)} fill={IN} fillOpacity={m.partial ? 0.45 : 1} />
              <path d={roundedTopRect(xOut, y(m.cashOut), barW, baseline - y(m.cashOut), 4)} fill={OUT} fillOpacity={m.partial ? 0.45 : 1} />
              <text x={center} y={HEIGHT - 18} textAnchor="middle" className="fill-[var(--color-ink-secondary)] text-[11px] font-medium">
                {m.label}
              </text>
              {m.partial && (
                <text x={center} y={HEIGHT - 6} textAnchor="middle" className="fill-[var(--color-viz-muted)] text-[10px]">
                  to date
                </text>
              )}
              <rect
                x={gx}
                y={MARGIN.top}
                width={groupW}
                height={plotH}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${m.label}${m.partial ? ' to date' : ''}: cash in ${money(m.cashIn)}, cash out ${money(m.cashOut)}`}
                className="focus:outline-hidden"
              />
            </g>
          );
        })}
      </svg>
      {hovered && hover !== null && (
        <ChartTooltip x={MARGIN.left + hover * groupW + groupW / 2} y={y(Math.max(hovered.cashIn, hovered.cashOut))} containerWidth={width}>
          <p className="mb-1 font-semibold text-white/90">
            {hovered.label}
            {hovered.partial ? ' (to date)' : ''}
          </p>
          <TooltipRow color={IN} label="Cash in" value={money(hovered.cashIn)} />
          <TooltipRow color={OUT} label="Cash out" value={money(hovered.cashOut)} />
          <div className="mt-1 border-t border-white/15 pt-1">
            <TooltipRow label="Net" value={signedMoney(hovered.cashIn - hovered.cashOut)} />
          </div>
        </ChartTooltip>
      )}
    </div>
  );
}
