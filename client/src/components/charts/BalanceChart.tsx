import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { DailyPoint, ForecastPoint } from '../../../../shared/types.ts';
import { useElementWidth } from '../../hooks/useElementWidth.ts';
import { longDate, money, shortDate } from '../../lib/format.ts';
import { compactMoney, niceTicks, scale } from './chartUtils.ts';
import { ChartTooltip, TooltipRow } from './Tooltip.tsx';

const SERIES = 'var(--color-series-1)';
const HEIGHT = 260;
const MARGIN = { top: 28, right: 20, bottom: 30, left: 56 };

interface Props {
  history: DailyPoint[];
  forecast: ForecastPoint[] | null;
}

type Point = { date: string; value: number; low?: number; high?: number; kind: 'history' | 'forecast' };

export function BalanceChart({ history, forecast }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const points = useMemo<Point[]>(
    () => [
      ...history.map((p) => ({ date: p.date, value: p.balance, kind: 'history' as const })),
      ...(forecast ?? []).map((p) => ({ date: p.date, value: p.projected, low: p.low, high: p.high, kind: 'forecast' as const })),
    ],
    [history, forecast],
  );

  const plotW = Math.max(120, width - MARGIN.left - MARGIN.right);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const lastHistoryIdx = history.length - 1;

  const { x, y, ticks } = useMemo(() => {
    const values = points.flatMap((p) => [p.value, p.low ?? p.value, p.high ?? p.value]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min) * 0.12 || 1000;
    const t = niceTicks(Math.max(0, min - pad), max + pad, 5);
    return {
      ticks: t,
      x: scale([0, Math.max(1, points.length - 1)], [MARGIN.left, MARGIN.left + plotW]),
      y: scale([t[0] as number, t[t.length - 1] as number], [MARGIN.top + plotH, MARGIN.top]),
    };
  }, [points, plotW, plotH]);

  const historyPath = useMemo(() => history.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' '), [history, x, y]);
  const areaPath = useMemo(() => {
    if (history.length === 0) return '';
    const base = y(ticks[0] as number);
    return `${historyPath} L${x(lastHistoryIdx).toFixed(1)},${base.toFixed(1)} L${x(0).toFixed(1)},${base.toFixed(1)} Z`;
  }, [historyPath, history.length, lastHistoryIdx, ticks, x, y]);

  const forecastPath = useMemo(() => {
    if (!forecast?.length || lastHistoryIdx < 0) return '';
    const start = `M${x(lastHistoryIdx).toFixed(1)},${y(history[lastHistoryIdx]?.balance ?? 0).toFixed(1)}`;
    return start + forecast.map((p, i) => ` L${x(lastHistoryIdx + 1 + i).toFixed(1)},${y(p.projected).toFixed(1)}`).join('');
  }, [forecast, history, lastHistoryIdx, x, y]);

  const bandPath = useMemo(() => {
    if (!forecast?.length) return '';
    const upper = forecast.map((p, i) => `${x(lastHistoryIdx + 1 + i).toFixed(1)},${y(p.high).toFixed(1)}`);
    const lower = [...forecast].reverse().map((p, i) => `${x(lastHistoryIdx + forecast.length - i).toFixed(1)},${y(p.low).toFixed(1)}`);
    const anchor = `${x(lastHistoryIdx).toFixed(1)},${y(history[lastHistoryIdx]?.balance ?? 0).toFixed(1)}`;
    return `M${anchor} L${upper.join(' L')} L${lower.join(' L')} Z`;
  }, [forecast, history, lastHistoryIdx, x, y]);

  const xTicks = useMemo(() => {
    const n = points.length;
    const count = width < 480 ? 4 : 6;
    const step = Math.max(1, Math.floor((n - 1) / (count - 1)));
    const idx: number[] = [];
    for (let i = 0; i < n; i += step) idx.push(i);
    // Replace a final tick that would sit on top of the end label.
    if (idx.length > 1 && n - 1 - (idx[idx.length - 1] as number) < step / 2) idx.pop();
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
    return idx;
  }, [points.length, width]);

  const indexFromPointer = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const ratio = (px - MARGIN.left) / plotW;
    return Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight') setHover((h) => Math.min(points.length - 1, (h ?? lastHistoryIdx) + 1));
    else if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? lastHistoryIdx) - 1));
    else if (e.key === 'Escape') setHover(null);
    else return;
    e.preventDefault();
  };

  const hovered = hover !== null ? points[hover] : undefined;
  const today = history[lastHistoryIdx];
  const end = forecast?.[forecast.length - 1];

  return (
    <div ref={ref} className="relative w-full min-w-0 overflow-hidden">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`Cash balance over the last ${history.length} days${forecast ? ` and a ${forecast.length}-day forecast` : ''}. Use the table view for exact values.`}
        tabIndex={0}
        onPointerMove={(e) => setHover(indexFromPointer(e))}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        className="block cursor-crosshair touch-pan-y select-none focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 rounded-lg"
      >
        {/* gridlines + y labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={y(t)} y2={y(t)} stroke="var(--color-viz-grid)" strokeWidth="1" />
            <text x={MARGIN.left - 8} y={y(t)} dy="0.35em" textAnchor="end" className="tabular fill-[var(--color-viz-muted)] text-[11px]">
              {compactMoney(t)}
            </text>
          </g>
        ))}
        {/* x labels */}
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={HEIGHT - 8} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="fill-[var(--color-viz-muted)] text-[11px]">
            {shortDate(points[i]?.date ?? '')}
          </text>
        ))}

        {/* history */}
        <path d={areaPath} fill={SERIES} fillOpacity="0.1" />
        <path d={historyPath} fill="none" stroke={SERIES} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* forecast */}
        {forecast && forecast.length > 0 && (
          <>
            <path d={bandPath} fill={SERIES} fillOpacity="0.08" />
            <path d={forecastPath} fill="none" stroke={SERIES} strokeWidth="2" strokeDasharray="5 5" strokeLinejoin="round" strokeLinecap="round" />
            <line x1={x(lastHistoryIdx)} x2={x(lastHistoryIdx)} y1={MARGIN.top - 6} y2={MARGIN.top + plotH} stroke="var(--color-viz-axis)" strokeWidth="1" />
            <text x={x(lastHistoryIdx) + 6} y={MARGIN.top - 10} className="fill-[var(--color-viz-muted)] text-[10px] font-semibold uppercase tracking-wide">
              Forecast
            </text>
          </>
        )}

        {/* direct labels: today + forecast end */}
        {today && (
          <g>
            <circle cx={x(lastHistoryIdx)} cy={y(today.balance)} r="5" fill={SERIES} stroke="var(--color-panel)" strokeWidth="2" />
            <text
              x={x(lastHistoryIdx)}
              y={y(today.balance) - 12}
              textAnchor={forecast ? 'middle' : 'end'}
              className="fill-[var(--color-ink)] text-[11px] font-semibold"
            >
              Today · {compactMoney(today.balance)}
            </text>
          </g>
        )}
        {end && forecast && (
          <text x={x(points.length - 1)} y={y(end.projected) - 12} textAnchor="end" className="fill-[var(--color-ink-secondary)] text-[11px] font-semibold">
            +{forecast.length}d · {compactMoney(end.projected)}
          </text>
        )}

        {/* crosshair */}
        {hovered && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={MARGIN.top + plotH} stroke="var(--color-viz-axis)" strokeWidth="1" />
            <circle cx={x(hover)} cy={y(hovered.value)} r="5" fill={SERIES} stroke="var(--color-panel)" strokeWidth="2" />
          </g>
        )}
      </svg>

      {hovered && hover !== null && (
        <ChartTooltip x={x(hover)} y={y(hovered.value)} containerWidth={width}>
          <p className="mb-1 font-semibold text-white/90">{longDate(hovered.date)}</p>
          {hovered.kind === 'history' ? (
            <TooltipRow color="#2a78d6" label="Balance" value={money(hovered.value)} />
          ) : (
            <>
              <TooltipRow color="#2a78d6" dashed label="Projected" value={money(hovered.value)} />
              <div className="mt-0.5 text-[11px] text-white/60">
                Range {compactMoney(hovered.low ?? hovered.value)} – {compactMoney(hovered.high ?? hovered.value)}
              </div>
            </>
          )}
        </ChartTooltip>
      )}
    </div>
  );
}
