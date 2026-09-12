import { useMemo, useState } from 'react';
import type { WeeklyFlow } from '../../../../shared/types.ts';
import { useElementWidth } from '../../hooks/useElementWidth.ts';
import { money, shortDate } from '../../lib/format.ts';
import { compactMoney, niceTicks, roundedTopRect, scale } from './chartUtils.ts';
import { ChartTooltip, TooltipRow } from './Tooltip.tsx';

const IN = '#2a78d6';
const OUT = '#eb6834';
const HEIGHT = 240;
const MARGIN = { top: 24, right: 8, bottom: 30, left: 56 };
const MAX_BAR = 24;
const GAP = 2;

export function FlowColumns({ weeks }: { weeks: WeeklyFlow[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const plotW = Math.max(120, width - MARGIN.left - MARGIN.right);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const n = Math.max(1, weeks.length);
  const groupW = plotW / n;
  const barW = Math.min(MAX_BAR, Math.max(6, (groupW - 10 - GAP) / 2));

  const { y, ticks } = useMemo(() => {
    const max = Math.max(1, ...weeks.flatMap((w) => [w.inflow, w.outflow]));
    const t = niceTicks(0, max * 1.1, 5);
    return { ticks: t, y: scale([0, t[t.length - 1] as number], [MARGIN.top + plotH, MARGIN.top]) };
  }, [weeks, plotH]);

  const baseline = y(0);
  const last = weeks.length - 1;
  const hovered = hover !== null ? weeks[hover] : undefined;

  return (
    <div ref={ref} className="relative w-full min-w-0 overflow-hidden">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`Weekly inflow and outflow for the last ${weeks.length} weeks. Use the table view for exact values.`}
        className="block select-none"
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--color-viz-axis)' : 'var(--color-viz-grid)'} strokeWidth="1" />
            <text x={MARGIN.left - 8} y={y(t)} dy="0.35em" textAnchor="end" className="tabular fill-[var(--color-viz-muted)] text-[11px]">
              {compactMoney(t)}
            </text>
          </g>
        ))}

        {weeks.map((w, i) => {
          const gx = MARGIN.left + i * groupW;
          const center = gx + groupW / 2;
          const xIn = center - barW - GAP / 2;
          const xOut = center + GAP / 2;
          const dim = hover !== null && hover !== i;
          const showLabel = width >= 520 ? i % Math.ceil(n / 6) === 0 || i === last : i === 0 || i === last;
          return (
            <g key={w.weekStart} opacity={dim ? 0.55 : 1} className="transition-opacity">
              <path d={roundedTopRect(xIn, y(w.inflow), barW, baseline - y(w.inflow), 4)} fill={IN} />
              <path d={roundedTopRect(xOut, y(w.outflow), barW, baseline - y(w.outflow), 4)} fill={OUT} />
              {i === last && barW >= 18 && (
                <>
                  <text x={Math.min(xIn + barW / 2, width - 40)} y={y(w.inflow) - 6} textAnchor="middle" className="tabular fill-[var(--color-ink)] text-[10px] font-semibold">
                    {compactMoney(w.inflow)}
                  </text>
                  <text x={Math.min(xOut + barW / 2, width - 18)} y={y(w.outflow) - 6} textAnchor="middle" className="tabular fill-[var(--color-ink)] text-[10px] font-semibold">
                    {compactMoney(w.outflow)}
                  </text>
                </>
              )}
              {showLabel && (
                <text x={center} y={HEIGHT - 8} textAnchor="middle" className="fill-[var(--color-viz-muted)] text-[11px]">
                  {shortDate(w.weekStart)}
                </text>
              )}
              {/* hit target covers the whole column */}
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
                aria-label={`Week of ${shortDate(w.weekStart)}: inflow ${money(w.inflow)}, outflow ${money(w.outflow)}`}
                className="focus:outline-hidden"
              />
            </g>
          );
        })}
      </svg>

      {hovered && hover !== null && (
        <ChartTooltip x={MARGIN.left + hover * groupW + groupW / 2} y={y(Math.max(hovered.inflow, hovered.outflow))} containerWidth={width}>
          <p className="mb-1 font-semibold text-white/90">Week of {shortDate(hovered.weekStart)}</p>
          <TooltipRow color={IN} label="Inflow" value={money(hovered.inflow)} />
          <TooltipRow color={OUT} label="Outflow" value={money(hovered.outflow)} />
          <div className="mt-1 border-t border-white/15 pt-1">
            <TooltipRow label="Net" value={`${hovered.inflow - hovered.outflow >= 0 ? '+' : '−'}${money(Math.abs(hovered.inflow - hovered.outflow))}`} />
          </div>
        </ChartTooltip>
      )}
    </div>
  );
}
