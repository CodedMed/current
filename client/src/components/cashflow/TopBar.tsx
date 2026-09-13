import { Building2, CalendarDays, Landmark, LogOut, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import type { CashAccount, CashflowCompany, CashflowDashboard, PeriodOption, PublicUser } from '../../../../shared/types.ts';
import { cn } from '../../lib/cn.ts';
import { initials, relativeTime } from '../../lib/format.ts';
import { Badge } from '../ui/Badge.tsx';
import { Button, buttonClasses } from '../ui/Button.tsx';
import { Logo } from '../ui/Logo.tsx';
import { Dropdown } from './Dropdown.tsx';
import { WorkspaceNav } from '../layout/WorkspaceNav.tsx';

export const SECTIONS = [
  { id: 'overview', label: 'Dashboard' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'reports', label: 'Reports' },
  { id: 'financing', label: 'Financing' },
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
  activeSection: SectionId;
  onCompanyChange: (id: string) => void;
  onAccountsChange: (ids: string[] | null) => void;
  onPeriodChange: (id: string) => void;
  onSync: () => void;
  onAddTransaction: () => void;
  onNavigate: (id: SectionId) => void;
  onSignOut: () => void;
}

export function TopBar(props: TopBarProps) {
  const { user, companies, companyId, dataSource, accounts, accountIds, periods, period, lastSyncedAt, syncing, loading, activeSection } = props;
  const live = dataSource?.provider === 'nessie' && dataSource.mode === 'live';
  const accountOptions = accounts.map((a) => ({ id: a.id, label: a.name, description: `${a.institutionName}${a.mask ? ` · •••• ${a.mask}` : ''}` }));
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-panel/95 backdrop-blur supports-[backdrop-filter]:bg-panel/85">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5 sm:px-8">
        <div className="flex items-center gap-3">
          <Logo />
          <Badge
            tone={live ? 'success' : 'warning'}
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
        </div>

        <div className="order-3 -mx-5 flex w-[calc(100%+2.5rem)] items-center gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:w-auto sm:px-0 sm:pb-0 lg:order-none lg:ml-2 lg:border-l lg:border-line lg:pl-4">
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

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <span className="hidden text-xs text-ink-muted md:inline" aria-live="polite">
            {syncing ? 'Syncing accounts…' : lastSyncedAt ? `Synced ${relativeTime(lastSyncedAt)}` : ''}
          </span>
          <Button variant="ghost" size="sm" onClick={props.onSync} loading={syncing} disabled={loading} icon={<RefreshCw className="size-4" aria-hidden="true" />} aria-label="Sync accounts">
            <span className="hidden sm:inline">Sync</span>
          </Button>
          <Button size="sm" onClick={props.onAddTransaction} disabled={loading} icon={<Plus className="size-4" aria-hidden="true" />}>
            <span className="hidden sm:inline">Add transaction</span>
            <span className="sm:hidden">Add</span>
          </Button>
          <Link to="/advisor" className={buttonClasses('secondary', 'sm')} title="Ask the cash-flow advisor">
            <Sparkles className="size-4 text-brand-600" aria-hidden="true" />
            <span className="hidden sm:inline">Advisor</span>
          </Link>
          {user && (
            <button
              type="button"
              onClick={props.onSignOut}
              className="inline-flex h-9 items-center gap-2 rounded-lg pr-2 pl-1 text-sm font-medium text-ink-secondary transition-colors hover:bg-ink/5 hover:text-ink"
              title={`Sign out ${user.email}`}
            >
              {user.picture ? (
                <img src={user.picture} alt="" className="size-7 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <span className="grid size-7 place-items-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-800">{initials(user.name)}</span>
              )}
              <LogOut className="size-4" aria-hidden="true" />
              <span className="sr-only">Sign out</span>
            </button>
          )}
        </div>
      </div>

      <WorkspaceNav />
      <nav className="mx-auto max-w-[1400px] px-5 sm:px-8" aria-label="Dashboard sections">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {SECTIONS.map((s) => {
            const active = s.id === activeSection;
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    props.onNavigate(s.id);
                  }}
                  className={cn(
                    'inline-flex h-10 items-center border-b-2 px-3 text-sm font-semibold whitespace-nowrap transition-colors',
                    active ? 'border-brand-600 text-ink' : 'border-transparent text-ink-secondary hover:border-line-strong hover:text-ink',
                  )}
                >
                  {s.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
