import { ChartLine, Table2 } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { CashPosition, ForecastHorizon, ForecastScenario } from '../../../../shared/types.ts';
import { useElementWidth } from '../../hooks/useElementWidth.ts';
import { cn } from '../../lib/cn.ts';
import { compactMoney, longDate, money, shortDate, signedMoney } from '../../lib/format.ts';
import { niceTicks, scale } from '../charts/chartUtils.ts';
import { ChartTooltip, TooltipRow } from '../charts/Tooltip.tsx';
import { Segmented } from './Segmented.tsx';

const SERIES = 'var(--color-series-1)';
const HEIGHT = 320;
const MARGIN = { top: 26, right: 18, bottom: 30, left: 58 };

const HORIZONS: Array<{ id: ForecastHorizon; label: string; title: string }> = [
  { id: 30, label: '30D', title: '30 days' },
  { id: 60, label: '60D', title: '60 days' },
  { id: 90, label: '90D', title: '90 days' },
  { id: 180, label: '6M', title: '6 months' },
  { id: 365, label: '12M', title: '12 months' },
];

const SCENARIOS: Array<{ id: ForecastScenario; label: string }> = [
  { id: 'expected', label: 'Expected' },
  { id: 'conservative', label: 'Conservative' },
  { id: 'optimistic', label: 'Optimistic' },
];

interface Props {
  position: CashPosition;
  showForecast: boolean;
  onShowForecast: (show: boolean) => void;
  onHorizon: (h: ForecastHorizon) => void;
  onScenario: (s: ForecastScenario) => void;
  /** Re-runs the draw-in animation when it changes (e.g. company switch). */
  animationKey: string;
}

type Point = { date: string; value: number; low?: number; high?: number; kind: 'history' | 'forecast' };

export function CashPositionChart({ position, showForecast, onShowForecast, onHorizon, onScenario, animationKey }: Props) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const { history, forecast, lowest, end, today, horizon, scenario } = position;
  const forecastShown = showForecast ? forecast : [];

  const points = useMemo<Point[]>(
    () => [
      ...history.map((p) => ({ date: p.date, value: p.balance, kind: 'history' as const })),
      ...forecastShown.map((p) => ({ date: p.date, value: p.projected, low: p.low, high: p.high, kind: 'forecast' as const })),
    ],
    [history, forecastShown],
  );

  const plotW = Math.max(160, width - MARGIN.left - MARGIN.right);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const todayIdx = history.length - 1;

  const { x, y, ticks } = useMemo(() => {
    const values = points.flatMap((p) => [p.value, p.low ?? p.value, p.high ?? p.value]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min) * 0.14 || 1000;
    const lo = min >= 0 ? Math.max(0, min - pad) : min - pad;
    const t = niceTicks(lo, max + pad, 5);
    return {
      ticks: t,
      x: scale([0, Math.max(1, points.length - 1)], [MARGIN.left, MARGIN.left + plotW]),
      y: scale([t[0] as number, t[t.length - 1] as number], [MARGIN.top + plotH, MARGIN.top]),
    };
  }, [points, plotW, plotH]);

  const line = (pts: Array<{ i: number; v: number }>) => pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');

  const historyPath = useMemo(() => line(history.map((p, i) => ({ i, v: p.balance }))), [history, x, y]);
  const areaPath = useMemo(() => {
    if (history.length === 0) return '';
    const base = y(ticks[0] as number);
    return `${historyPath} L${x(todayIdx).toFixed(1)},${base.toFixed(1)} L${x(0).toFixed(1)},${base.toFixed(1)} Z`;
  }, [historyPath, history.length, todayIdx, ticks, x, y]);
  const forecastPath = useMemo(() => {
    if (forecastShown.length === 0 || todayIdx < 0) return '';
    return line([{ i: todayIdx, v: history[todayIdx]?.balance ?? 0 }, ...forecastShown.map((p, i) => ({ i: todayIdx + 1 + i, v: p.projected }))]);
  }, [forecastShown, history, todayIdx, x, y]);
  const bandPath = useMemo(() => {
    if (forecastShown.length === 0) return '';
    const anchor = `${x(todayIdx).toFixed(1)},${y(history[todayIdx]?.balance ?? 0).toFixed(1)}`;
    const upper = forecastShown.map((p, i) => `${x(todayIdx + 1 + i).toFixed(1)},${y(p.high).toFixed(1)}`);
    const lower = [...forecastShown].reverse().map((p, i) => `${x(todayIdx + forecastShown.length - i).toFixed(1)},${y(p.low).toFixed(1)}`);
    return `M${anchor} L${upper.join(' L')} L${lower.join(' L')} Z`;
  }, [forecastShown, history, todayIdx, x, y]);

  // One label per month start, thinned when the range is long.
  const xTicks = useMemo(() => {
    const starts = points.map((p, i) => ({ i, first: i === 0 || p.date.endsWith('-01') })).filter((t) => t.first).map((t) => t.i);
    const maxLabels = width < 520 ? 4 : width < 900 ? 7 : 12;
    const step = Math.max(1, Math.ceil(starts.length / maxLabels));
    return starts.filter((_, k) => k % step === 0);
  }, [points, width]);

  const lowestIdx = useMemo(() => (showForecast ? forecastShown.findIndex((p) => p.date === lowest.date) : -1), [forecastShown, lowest.date, showForecast]);
  const lowestPoint = lowestIdx >= 0 ? points[todayIdx + 1 + lowestIdx] : undefined;

  const indexFromPointer = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left - MARGIN.left) / plotW;
    return Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight') setHover((h) => Math.min(points.length - 1, (h ?? todayIdx) + 1));
    else if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? todayIdx) - 1));
    else if (e.key === 'Escape') setHover(null);
    else return;
    e.preventDefault();
  };

  const hovered = hover !== null ? points[hover] : undefined;
  const zeroInRange = (ticks[0] as number) < 0 && (ticks[ticks.length - 1] as number) > 0;
  const change = end.projected - today.balance;

  return (
    <section className="flex min-w-0 flex-col rounded-2xl bg-panel shadow-card ring-1 ring-ink/5" aria-label="Cash position">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Bank activity forecast</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            <span className="tabular font-semibold text-ink">{money(today.balance)}</span> today
            {showForecast && (
              <>
                {' '}
                · <span className="tabular font-semibold text-ink">{money(end.projected)}</span> projected in {horizon} days
                <span className={cn('tabular ml-1.5 font-medium', change >= 0 ? 'text-positive-700' : 'text-danger-600')}>({signedMoney(change, { compact: true })})</span>
              </>
            )}
          </p>
        </div>
        <div className="inline-flex rounded-lg bg-surface p-0.5" role="group" aria-label="View as">
          <ViewButton active={view === 'chart'} onClick={() => setView('chart')} label="Chart">
            <ChartLine className="size-4" aria-hidden="true" />
          </ViewButton>
          <ViewButton active={view === 'table'} onClick={() => setView('table')} label="Table">
            <Table2 className="size-4" aria-hidden="true" />
          </ViewButton>
        </div>
      </header>

      <p className="px-5 pt-2 text-xs text-ink-muted sm:px-6">Projects recurring bank activity. Uploaded invoices appear in Cash commitments above.</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pt-4 sm:px-6">
        <Segmented
          label="Series"
          options={[
            { id: 'both', label: 'Actual + forecast' },
            { id: 'actual', label: 'Actual only' },
          ]}
          value={showForecast ? 'both' : 'actual'}
          onChange={(v) => onShowForecast(v === 'both')}
        />
        {showForecast && <Segmented label="Forecast scenario" options={SCENARIOS} value={scenario} onChange={onScenario} />}
        <Segmented label="Forecast horizon" options={HORIZONS} value={horizon} onChange={onHorizon} className="sm:ml-auto" />
      </div>

      <div className="px-2 pt-2 pb-4 sm:px-4">
        {view === 'chart' ? (
          <div ref={ref} className="relative w-full min-w-0 overflow-hidden">
            <svg
              width={width}
              height={HEIGHT}
              role="img"
              aria-label={`Cash balance over the last ${history.length} days${showForecast ? ` and a ${forecast.length}-day forecast` : ''}. Use the table view for exact values.`}
              tabIndex={0}
              onPointerMove={(e) => setHover(indexFromPointer(e))}
              onPointerLeave={() => setHover(null)}
              onKeyDown={onKeyDown}
              className="block cursor-crosshair touch-pan-y rounded-lg select-none focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {ticks.map((t) => (
                <g key={t}>
                  <line
                    x1={MARGIN.left}
                    x2={MARGIN.left + plotW}
                    y1={y(t)}
                    y2={y(t)}
                    stroke={zeroInRange && t === 0 ? 'var(--color-viz-axis)' : 'var(--color-viz-grid)'}
                    strokeWidth="1"
                  />
                  <text x={MARGIN.left - 8} y={y(t)} dy="0.35em" textAnchor="end" className="tabular fill-[var(--color-viz-muted)] text-[11px]">
                    {compactMoney(t)}
                  </text>
                </g>
              ))}
              {xTicks.map((i) => (
                <text key={i} x={x(i)} y={HEIGHT - 9} textAnchor={i === 0 ? 'start' : 'middle'} className="fill-[var(--color-viz-muted)] text-[11px]">
                  {monthLabel(points[i]?.date ?? '')}
                </text>
              ))}

              {/* forecast region tint */}
              {forecastShown.length > 0 && <rect x={x(todayIdx)} y={MARGIN.top} width={x(points.length - 1) - x(todayIdx)} height={plotH} fill="var(--color-surface)" opacity="0.6" />}

              <path d={areaPath} fill={SERIES} fillOpacity="0.09" />
              <path
                key={animationKey}
                d={historyPath}
                fill="none"
                stroke={SERIES}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray="1"
                className="animate-draw-line"
              />

              {forecastShown.length > 0 && (
                <>
                  <path d={bandPath} fill={SERIES} fillOpacity="0.1" />
                  <path d={forecastPath} fill="none" stroke={SERIES} strokeWidth="2" strokeDasharray="5 5" strokeLinejoin="round" strokeLinecap="round" />
                </>
              )}

              {/* today */}
              {todayIdx >= 0 && (
                <g>
                  <line x1={x(todayIdx)} x2={x(todayIdx)} y1={MARGIN.top - 4} y2={MARGIN.top + plotH} stroke="var(--color-navy-900)" strokeWidth="1" strokeOpacity="0.35" />
                  <text x={x(todayIdx)} y={MARGIN.top - 10} textAnchor={showForecast ? 'middle' : 'end'} className="fill-[var(--color-ink-secondary)] text-[10px] font-semibold">
                    Today
                  </text>
                  <circle cx={x(todayIdx)} cy={y(today.balance)} r="4.5" fill={SERIES} stroke="var(--color-panel)" strokeWidth="2" />
                </g>
              )}

              {/* lowest projected */}
              {lowestPoint && lowestIdx !== 0 && (
                <g>
                  <circle cx={x(todayIdx + 1 + lowestIdx)} cy={y(lowestPoint.value)} r="5" fill="var(--color-panel)" stroke={SERIES} strokeWidth="2" />
                  <text
                    x={x(todayIdx + 1 + lowestIdx)}
                    y={y(lowestPoint.value) + 18}
                    textAnchor={x(todayIdx + 1 + lowestIdx) > width - 90 ? 'end' : 'middle'}
                    className="tabular fill-[var(--color-ink)] text-[11px] font-semibold"
                  >
                    Low · {compactMoney(lowestPoint.value)}
                  </text>
                </g>
              )}

              {showForecast && forecastShown.length > 0 && (
                <text x={x(points.length - 1)} y={y(end.projected) - 12} textAnchor="end" className="tabular fill-[var(--color-ink-secondary)] text-[11px] font-semibold">
                  +{horizon}d · {compactMoney(end.projected)}
                </text>
              )}

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
                      Likely {compactMoney(hovered.low ?? hovered.value)} – {compactMoney(hovered.high ?? hovered.value)}
                    </div>
                  </>
                )}
              </ChartTooltip>
            )}

            <div className="flex flex-wrap items-center gap-4 px-3 pt-1 text-xs font-medium text-ink-secondary">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0 w-4 border-t-2 border-[#2a78d6]" aria-hidden="true" /> Actual
              </span>
              {showForecast && (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-0 w-4 border-t-2 border-dashed border-[#2a78d6]" aria-hidden="true" /> Forecast
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-4 rounded-[3px] bg-[#2a78d6]/15" aria-hidden="true" /> Likely range
                  </span>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="mx-3 max-h-80 overflow-auto rounded-xl ring-1 ring-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-left text-xs font-semibold text-ink-secondary">
                <tr>
                  <th scope="col" className="px-3 py-2">Date</th>
                  <th scope="col" className="px-3 py-2">Type</th>
                  <th scope="col" className="px-3 py-2 text-right">Balance</th>
                  <th scope="col" className="px-3 py-2 text-right">Low</th>
                  <th scope="col" className="px-3 py-2 text-right">High</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.date} className="border-t border-line">
                    <td className="px-3 py-1.5 whitespace-nowrap text-ink-secondary">{shortDate(p.date)}</td>
                    <td className="px-3 py-1.5 text-ink-secondary">{p.kind === 'history' ? 'Actual' : 'Projected'}</td>
                    <td className="tabular px-3 py-1.5 text-right text-ink">{money(p.value)}</td>
                    <td className="tabular px-3 py-1.5 text-right text-ink-muted">{p.low !== undefined ? money(p.low) : ''}</td>
                    <td className="tabular px-3 py-1.5 text-right text-ink-muted">{p.high !== undefined ? money(p.high) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function monthLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1));
  return d.toLocaleDateString('en-US', { month: 'short', ...(m === 1 ? { year: '2-digit' } : {}), timeZone: 'UTC' });
}

function ViewButton({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn('grid size-8 place-items-center rounded-md transition-colors', active ? 'bg-panel text-ink shadow-ring' : 'text-ink-muted hover:text-ink')}
    >
      {children}
    </button>
  );
}
