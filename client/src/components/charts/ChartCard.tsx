import { ChartLine, Table2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

export interface ChartTable {
  columns: string[];
  rows: Array<Array<string | number>>;
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  table: ChartTable;
  children: ReactNode;
  className?: string;
}

/** Card chrome for a chart with its accessible table twin. */
export function ChartCard({ title, subtitle, legend, table, children, className }: ChartCardProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className={cn('min-w-0 rounded-2xl bg-panel p-5 shadow-card ring-1 ring-ink/5 sm:p-6', className)} aria-label={title}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          {view === 'chart' && legend}
          <div className="inline-flex rounded-lg bg-surface p-0.5" role="group" aria-label="View as">
            <ViewButton active={view === 'chart'} onClick={() => setView('chart')} label="Chart">
              <ChartLine className="size-4" aria-hidden="true" />
            </ViewButton>
            <ViewButton active={view === 'table'} onClick={() => setView('table')} label="Table">
              <Table2 className="size-4" aria-hidden="true" />
            </ViewButton>
          </div>
        </div>
      </header>
      {view === 'chart' ? (
        children
      ) : (
        <div className="max-h-80 overflow-auto rounded-xl ring-1 ring-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-left text-xs font-semibold text-ink-secondary">
              <tr>
                {table.columns.map((c, i) => (
                  <th key={c} scope="col" className={cn('px-3 py-2', i > 0 && 'text-right')}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r} className="border-t border-line">
                  {row.map((cell, i) => (
                    <td key={i} className={cn('px-3 py-1.5 whitespace-nowrap', i > 0 ? 'tabular text-right text-ink' : 'text-ink-secondary')}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ViewButton({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: ReactNode }) {
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

export function LegendSwatch({ color, label, shape = 'rect' }: { color: string; label: string; shape?: 'rect' | 'line' | 'dashed' }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-secondary">
      {shape === 'rect' ? (
        <span className="size-3 rounded-[3px]" style={{ background: color }} aria-hidden="true" />
      ) : (
        <span
          className="h-0 w-4 border-t-2"
          style={{ borderColor: color, borderStyle: shape === 'dashed' ? 'dashed' : 'solid' }}
          aria-hidden="true"
        />
      )}
      {label}
    </span>
  );
}
