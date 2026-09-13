import { Building2, CalendarDays, Landmark, Plus, RefreshCw } from 'lucide-react';
import { NavLink } from 'react-router';
import type { CashAccount, CashflowCompany, CashflowDashboard, PeriodOption, PublicUser } from '../../../../shared/types.ts';
import { cn } from '../../lib/cn.ts';
import { relativeTime } from '../../lib/format.ts';
import { WorkspaceHeader } from '../layout/WorkspaceHeader.tsx';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { Dropdown } from './Dropdown.tsx';

export const SECTIONS = [
  { id: 'overview', label: 'Dashboard', to: '/dashboard' },
  { id: 'transactions', label: 'Transactions', to: '/dashboard/transactions' },
  { id: 'forecast', label: 'Forecast', to: '/dashboard/forecast' },
  { id: 'accounts', label: 'Accounts', to: '/dashboard/accounts' },
  { id: 'reports', label: 'Reports', to: '/dashboard/reports' },
  { id: 'financing', label: 'Financing', to: '/dashboard/financing' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

interface TopBarProps {
  user: PublicUser | null;
  companies: CashflowCompany[];
  companyId: string;
  dataSource: CashflowDashboard['dataSource'] | null;
  accounts: CashAccount[];
  accountIds: string[] | null;
  periods: PeriodOption[];
  period: string;
  lastSyncedAt: string | null;
  syncing: boolean;
  loading: boolean;
  onCompanyChange: (id: string) => void;
  onAccountsChange: (ids: string[] | null) => void;
  onPeriodChange: (id: string) => void;
  onAddTransaction: () => void;
  onSignOut: () => void;
}

/** The workspace header as the dashboard wears it: data provenance, the section tabs, the filters. */
export function TopBar(props: TopBarProps) {
  const { user, companies, companyId, dataSource, accounts, accountIds, periods, period, lastSyncedAt, syncing, loading } = props;
  const live = dataSource?.provider === 'nessie' && dataSource.mode === 'live';
  const accountOptions = accounts.map((a) => ({
    id: a.id,
    label: a.name,
    description: `${a.institutionName}${a.mask ? ` · •••• ${a.mask}` : ''}`,
  }));

  const status = (
    <>
      <Badge
        tone={live ? 'success' : 'warning'}
        className="hidden shrink-0 sm:inline-flex"
        title={
          dataSource?.provider === 'nessie'
            ? live
              ? 'Figures come from your Nessie workspace through the live banking API'
              : 'Figures come from the in-memory Nessie sandbox (no NESSIE_API_KEY set)'
            : 'Figures come from the generated sample ledger, not a bank connection'
        }
      >
        {dataSource?.label ?? 'Loading…'}
      </Badge>
      <span className="hidden items-center gap-1.5 text-xs text-ink-muted lg:inline-flex" aria-live="polite">
        {syncing ? (
          <>
            <RefreshCw className="size-3 animate-spin" aria-hidden="true" />
            Syncing…
          </>
        ) : (
          lastSyncedAt && `Synced ${relativeTime(lastSyncedAt)}`
        )}
      </span>
    </>
  );

  const toolbar = (
    <div className="mx-auto flex max-w-[1400px] flex-wrap items-end gap-x-4 px-5 sm:px-8">
      <nav className="order-2 min-w-0 flex-1 lg:order-none" aria-label="Dashboard sections">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <NavLink
                to={s.to}
                end={s.to === '/dashboard'}
                className={({ isActive }) =>
                  cn(
                    'inline-flex h-10 items-center border-b-2 px-3 text-sm font-semibold whitespace-nowrap transition-colors',
                    isActive ? 'border-brand-600 text-ink' : 'border-transparent text-ink-secondary hover:border-line-strong hover:text-ink',
                  )
                }
              >
                {s.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="order-1 -mx-5 flex w-[calc(100%+2.5rem)] shrink-0 items-center gap-2 overflow-x-auto px-5 pb-2 lg:order-none lg:mx-0 lg:w-auto lg:px-0">
        <Dropdown
          label="Company"
          icon={<Building2 className="size-4" aria-hidden="true" />}
          options={companies.map((c) => ({ id: c.id, label: c.name, description: c.legalName }))}
          value={companyId}
          onChange={props.onCompanyChange}
        />
        <Dropdown
          multi
          label="Accounts"
          allLabel="All accounts"
          icon={<Landmark className="size-4" aria-hidden="true" />}
          options={accountOptions}
          value={accountIds}
          onChange={props.onAccountsChange}
        />
        <Dropdown label="Period" icon={<CalendarDays className="size-4" aria-hidden="true" />} options={periods} value={period} onChange={props.onPeriodChange} />
      </div>
    </div>
  );

  return (
    <WorkspaceHeader
      user={user}
      status={status}
      toolbar={toolbar}
      onSignOut={props.onSignOut}
      actions={
        <Button size="sm" onClick={props.onAddTransaction} disabled={loading} icon={<Plus className="size-4" aria-hidden="true" />}>
          <span className="hidden sm:inline">Add transaction</span>
          <span className="sm:hidden">Add</span>
        </Button>
      }
    />
  );
}
