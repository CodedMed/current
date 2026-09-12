import { ArrowLeftRight, Building2, CalendarClock, CreditCard, Landmark, PiggyBank, Wallet, Zap } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type {
  CashManagement,
  CategorySpend,
  DashboardAccount,
  Receivable,
  ReportSummary,
  TransactionItem,
  UpcomingBill,
  VendorSummary,
  WorkflowSuggestion,
} from '../../../../shared/types.ts';
import { cn } from '../../lib/cn.ts';
import { dueLabel, money, pct, shortDate } from '../../lib/format.ts';
import { CategoryBars } from '../charts/CategoryBars.tsx';
import { Meter } from '../charts/Meter.tsx';
import { Badge, type BadgeTone } from '../ui/Badge.tsx';

export function Module({ title, subtitle, aside, children, className }: { title: string; subtitle?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 rounded-2xl bg-panel p-5 shadow-card ring-1 ring-ink/5 sm:p-6', className)} aria-label={title}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-ink-muted">{children}</p>;
}

function dueTone(days: number): BadgeTone {
  return days < 0 ? 'danger' : days <= 7 ? 'warning' : 'neutral';
}

/* ───────────── Receivables ───────────── */

export function ReceivablesModule({ items, open, overdue }: { items: Receivable[]; open: number; overdue: number }) {
  return (
    <Module
      title="Income & receivables"
      subtitle={`${money(open)} open${overdue > 0 ? ` · ${money(overdue)} overdue` : ''}`}
      aside={overdue > 0 ? <Badge tone="danger">Action needed</Badge> : <Badge tone="success">On track</Badge>}
    >
      {items.length === 0 ? (
        <EmptyRow>No open invoices. Everything you have billed has been paid.</EmptyRow>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{r.customer}</span>
                <span className="block text-xs text-ink-muted">
                  {r.reference} · due {shortDate(r.dueDate)}
                </span>
              </span>
              <Badge tone={dueTone(r.daysUntilDue)}>{dueLabel(r.daysUntilDue)}</Badge>
              <span className="tabular w-24 text-right text-sm font-semibold text-ink">{money(r.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Module>
  );
}

/* ───────────── Bills ───────────── */

export function BillsModule({ bills, due14d }: { bills: UpcomingBill[]; due14d: number }) {
  return (
    <Module title="Expenses & bills" subtitle={`${money(due14d)} due in the next 14 days`} aside={<CalendarClock className="size-5 text-ink-muted" aria-hidden="true" />}>
      {bills.length === 0 ? (
        <EmptyRow>No bills scheduled in the next 45 days.</EmptyRow>
      ) : (
        <ul className="divide-y divide-line">
          {bills.slice(0, 7).map((b) => (
            <li key={b.id} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{b.payee}</span>
                <span className="block text-xs text-ink-muted">
                  {b.nickname} · {b.recurring ? 'recurring' : 'one-time'} · {shortDate(b.dueDate)}
                </span>
              </span>
              <Badge tone={dueTone(b.daysUntilDue)}>{dueLabel(b.daysUntilDue)}</Badge>
              <span className="tabular w-24 text-right text-sm font-semibold text-ink">{money(b.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Module>
  );
}

/* ───────────── Categories ───────────── */

export function CategoriesModule({ categories }: { categories: CategorySpend[] }) {
  return (
    <Module title="Spending by category" subtitle="Last 30 days, with change versus the prior 30">
      {categories.length === 0 ? <EmptyRow>No spending recorded in the last 30 days.</EmptyRow> : <CategoryBars categories={categories.slice(0, 7)} />}
    </Module>
  );
}

/* ───────────── Vendors ───────────── */

export function VendorsModule({ vendors }: { vendors: VendorSummary[] }) {
  return (
    <Module title="Vendor payments" subtitle="Who you pay most, last 90 days" className="lg:col-span-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs font-semibold text-ink-secondary">
            <tr>
              <th scope="col" className="pb-2 pr-3">Vendor</th>
              <th scope="col" className="pb-2 pr-3">Category</th>
              <th scope="col" className="pb-2 pr-3 text-right">Spent</th>
              <th scope="col" className="pb-2 pr-3 text-right">Payments</th>
              <th scope="col" className="pb-2 pr-3 text-right">Last paid</th>
              <th scope="col" className="pb-2 text-right">Next due</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => (
              <tr key={v.id} className="border-t border-line">
                <td className="py-2.5 pr-3 font-semibold text-ink">{v.name}</td>
                <td className="py-2.5 pr-3 text-ink-secondary">{v.category}</td>
                <td className="tabular py-2.5 pr-3 text-right text-ink">{money(v.spent90d)}</td>
                <td className="tabular py-2.5 pr-3 text-right text-ink-secondary">{v.payments}</td>
                <td className="tabular py-2.5 pr-3 text-right text-ink-secondary">{shortDate(v.lastPaid)}</td>
                <td className="py-2.5 text-right">{v.nextDue ? <Badge tone="warning">{shortDate(v.nextDue)}</Badge> : <span className="text-ink-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Module>
  );
}

/* ───────────── Report ───────────── */

export function ReportModule({ report }: { report: ReportSummary }) {
  const rows: Array<{ label: string; value: number; change: number | null; goodWhenUp: boolean }> = [
    { label: 'Revenue', value: report.revenue, change: report.revenueChange, goodWhenUp: true },
    { label: 'Expenses', value: report.expenses, change: report.expensesChange, goodWhenUp: false },
  ];
  return (
    <Module title="Financial report" subtitle={report.periodLabel}>
      <dl className="space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between">
            <dt className="text-sm text-ink-secondary">{r.label}</dt>
            <dd className="flex items-center gap-2">
              <span className="tabular text-sm font-semibold text-ink">{money(r.value)}</span>
              <span className={cn('tabular w-14 text-right text-xs', changeTone(r.change, r.goodWhenUp))}>{pct(r.change)}</span>
            </dd>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-line pt-3">
          <dt className="text-sm font-semibold text-ink">Net income</dt>
          <dd className="flex items-center gap-2">
            <span className={cn('tabular text-base font-bold', report.netIncome >= 0 ? 'text-positive-700' : 'text-danger-700')}>{money(report.netIncome)}</span>
            <span className="tabular text-xs whitespace-nowrap text-ink-muted">{report.margin.toFixed(0)}% margin</span>
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-xs font-semibold text-ink-secondary">Largest expense lines</p>
      <ul className="mt-2 space-y-1.5">
        {report.topCategories.slice(0, 4).map((c) => (
          <li key={c.category} className="flex items-center justify-between text-sm">
            <span className="text-ink-secondary">{c.category}</span>
            <span className="tabular text-ink">
              {money(c.amount)} <span className="text-xs text-ink-muted">({c.share.toFixed(0)}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </Module>
  );
}

function changeTone(change: number | null, goodWhenUp: boolean): string {
  if (change === null || Math.abs(change) < 0.05) return 'text-ink-muted';
  const good = change > 0 ? goodWhenUp : !goodWhenUp;
  return good ? 'text-positive-700' : 'text-danger-600';
}

/* ───────────── Cash management ───────────── */

export function CashManagementModule({ cash }: { cash: CashManagement }) {
  return (
    <Module title="Business cash management" subtitle="Operating cash, reserves, and card exposure" aside={<Landmark className="size-5 text-ink-muted" aria-hidden="true" />}>
      <dl className="grid grid-cols-3 gap-3">
        <Figure icon={<Wallet className="size-4" aria-hidden="true" />} label="Operating" value={money(cash.operatingBalance)} />
        <Figure icon={<PiggyBank className="size-4" aria-hidden="true" />} label="Reserve" value={money(cash.reserveBalance)} />
        <Figure icon={<CreditCard className="size-4" aria-hidden="true" />} label="Card owed" value={money(cash.cardBalance)} />
      </dl>
      <div className="mt-5">
        <Meter value={cash.reserveCoverage} label={`Reserve coverage of one month of outflows (${money(cash.reserveTarget)})`} />
      </div>
      <p className="mt-4 rounded-xl bg-brand-50/70 p-3.5 text-sm leading-relaxed text-brand-900 ring-1 ring-brand-100">{cash.suggestion}</p>
    </Module>
  );
}

function Figure({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface p-3">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-ink-secondary">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-[15px] font-bold text-ink">{value}</dd>
    </div>
  );
}

/* ───────────── Workflows ───────────── */

export function WorkflowsModule({ workflows }: { workflows: WorkflowSuggestion[] }) {
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Module title="Automated workflows" subtitle="Suggested for your priorities. Turn on what you want running." aside={<Zap className="size-5 text-ink-muted" aria-hidden="true" />} className="lg:col-span-2">
      <ul className="grid gap-3 md:grid-cols-2">
        {workflows.map((w) => {
          const on = enabled.has(w.id);
          return (
            <li key={w.id} className={cn('flex gap-3 rounded-xl p-4 ring-1 transition-colors', on ? 'bg-brand-50/60 ring-brand-200' : 'bg-surface ring-line')}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{w.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{w.description}</p>
                <p className="mt-2 text-xs text-ink-muted">Trigger: {w.trigger}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`${on ? 'Disable' : 'Enable'} ${w.title}`}
                onClick={() => toggle(w.id)}
                className={cn('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors', on ? 'bg-brand-600' : 'bg-line-strong')}
              >
                <span className={cn('absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform', on && 'translate-x-5')} />
              </button>
            </li>
          );
        })}
      </ul>
    </Module>
  );
}

/* ───────────── Accounts & transactions ───────────── */

const ACCOUNT_ICON = {
  Checking: Wallet,
  Savings: PiggyBank,
  'Credit Card': CreditCard,
} as const;

export function AccountsModule({ accounts }: { accounts: DashboardAccount[] }) {
  return (
    <Module title="Accounts" subtitle="Connected through the banking API" aside={<Building2 className="size-5 text-ink-muted" aria-hidden="true" />}>
      <ul className="space-y-2">
        {accounts.map((a) => {
          const Icon = ACCOUNT_ICON[a.type];
          const liability = a.type === 'Credit Card';
          return (
            <li key={a.id} className="flex items-center gap-3 rounded-xl bg-surface px-3.5 py-3">
              <span className="grid size-9 place-items-center rounded-lg bg-panel text-ink-secondary shadow-ring">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{a.nickname}</span>
                <span className="block text-xs text-ink-muted">{a.type}</span>
              </span>
              <span className={cn('tabular text-sm font-semibold', liability ? 'text-danger-700' : 'text-ink')}>
                {liability ? '−' : ''}
                {money(a.balance, { cents: true })}
              </span>
            </li>
          );
        })}
      </ul>
    </Module>
  );
}

export function TransactionsModule({ transactions }: { transactions: TransactionItem[] }) {
  return (
    <Module title="Recent activity" subtitle="Latest transactions across all accounts" className="lg:col-span-2" aside={<ArrowLeftRight className="size-5 text-ink-muted" aria-hidden="true" />}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-left text-xs font-semibold text-ink-secondary">
            <tr>
              <th scope="col" className="pb-2 pr-3">Date</th>
              <th scope="col" className="pb-2 pr-3">Description</th>
              <th scope="col" className="pb-2 pr-3">Category</th>
              <th scope="col" className="pb-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id} className="border-t border-line">
                <td className="tabular py-2.5 pr-3 whitespace-nowrap text-ink-secondary">{shortDate(t.date)}</td>
                <td className="py-2.5 pr-3 font-medium text-ink">{t.description}</td>
                <td className="py-2.5 pr-3 text-ink-secondary">{t.category}</td>
                <td className={cn('tabular py-2.5 text-right font-semibold whitespace-nowrap', t.direction === 'in' ? 'text-positive-700' : t.direction === 'internal' ? 'text-ink-muted' : 'text-ink')}>
                  {t.direction === 'in' ? '+' : t.direction === 'out' ? '−' : ''}
                  {money(t.amount, { cents: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Module>
  );
}
