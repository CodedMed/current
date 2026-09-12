import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CashflowKpis, ResolvedPeriod } from '../../../../shared/types.ts';
import { cn } from '../../lib/cn.ts';
import { compactMoney, money, pct, signedMoney } from '../../lib/format.ts';

interface KpiStripProps {
  kpis: CashflowKpis;
  period: ResolvedPeriod;
}

/** One instrument panel: four readings separated by hairlines rather than four floating cards. */
export function KpiStrip({ kpis, period }: KpiStripProps) {
  const { totalCash, cashIn, cashOut, net } = kpis;
  const netTone = net.value > 0 ? 'text-positive-700' : net.value < 0 ? 'text-danger-700' : 'text-ink';
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl bg-line shadow-card ring-1 ring-ink/5 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Key figures">
      <Cell label="Total cash" hint={`${totalCash.accountCount} account${totalCash.accountCount === 1 ? '' : 's'}`}>
        <Value large>{money(totalCash.book)}</Value>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 text-xs text-ink-muted">
          <span>
            Available <span className="tabular font-semibold text-ink-secondary">{money(totalCash.available)}</span>
          </span>
          {totalCash.pending !== 0 && (
            <span>
              Pending <span className="tabular font-semibold text-ink-secondary">{signedMoney(totalCash.pending)}</span>
            </span>
          )}
        </p>
        <Trend value={totalCash.changeThisMonth} kind="money" goodWhenUp label={`in ${totalCash.monthLabel}`} />
      </Cell>

      <Cell label="Cash in" hint={period.label}>
        <Value>{money(cashIn.value)}</Value>
        <Trend value={cashIn.delta.pct} kind="pct" goodWhenUp label={period.compareLabel} />
        <Sub>Prior period {money(cashIn.delta.prior)}</Sub>
      </Cell>

      <Cell label="Cash out" hint={period.label}>
        <Value>{money(cashOut.value)}</Value>
        <Trend value={cashOut.delta.pct} kind="pct" goodWhenUp={false} label={period.compareLabel} />
        <Sub>Prior period {money(cashOut.delta.prior)}</Sub>
      </Cell>

      <Cell label="Net cash flow" hint={period.label}>
        <Value className={netTone}>{signedMoney(net.value)}</Value>
        <Trend value={net.delta.abs} kind="money" goodWhenUp label={period.compareLabel} />
        <Sub>
          {compactMoney(net.cashIn)} in · {compactMoney(net.cashOut)} out
        </Sub>
      </Cell>
    </div>
  );
}

function Cell({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="bg-panel p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink-secondary">{label}</p>
        {hint && <p className="truncate text-xs text-ink-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Value({ children, large = false, className }: { children: ReactNode; large?: boolean; className?: string }) {
  return <p className={cn('tabular mt-2 font-bold tracking-tight text-ink', large ? 'text-[34px] leading-none sm:text-[38px]' : 'text-[28px] leading-none', className)}>{children}</p>;
}

function Sub({ children }: { children: ReactNode }) {
  return <p className="tabular mt-1.5 text-xs text-ink-muted">{children}</p>;
}

function Trend({ value, kind, goodWhenUp, label }: { value: number | null; kind: 'pct' | 'money'; goodWhenUp: boolean; label: string }) {
  const direction = value === null ? 'flat' : value > 0.05 ? 'up' : value < -0.05 ? 'down' : 'flat';
  const good = direction === 'flat' ? null : direction === 'up' ? goodWhenUp : !goodWhenUp;
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  const text = value === null ? '—' : kind === 'pct' ? pct(value, 1) : signedMoney(value, { compact: true });
  return (
    <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted">
      <span
        className={cn(
          'tabular inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold',
          good === null ? 'bg-surface text-ink-secondary' : good ? 'bg-positive-50 text-positive-700' : 'bg-danger-50 text-danger-700',
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        {text}
      </span>
      <span className="truncate">{label}</span>
    </p>
  );
}
