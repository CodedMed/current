import { ArrowRight, Bookmark, BookmarkCheck, CircleAlert, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CreditProfile, LoanOffer, LoanOffersResponse, LoanProductType } from '../../../../shared/types.ts';
import { FinancingDrawer } from '../../components/cashflow/FinancingDrawer.tsx';
import { InstitutionMark } from '../../components/cashflow/InstitutionMark.tsx';
import { Alert } from '../../components/ui/Alert.tsx';
import { Badge, type BadgeTone } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { mediumDate, money } from '../../lib/format.ts';
import { PageHeading } from './PageHeading.tsx';
import { useWorkspace } from './WorkspaceLayout.tsx';

const TIER_TONE: Record<string, BadgeTone> = { A: 'success', B: 'brand', C: 'neutral' };

const TYPE_LABEL: Record<LoanProductType, string> = {
  LINE_OF_CREDIT: 'Line of credit',
  SBA_7A: 'SBA 7(a)',
  TERM_LOAN: 'Term loan',
  REVENUE_BASED: 'Revenue-based',
  BUSINESS_CARD: 'Business card',
  EQUIPMENT: 'Equipment',
};

type Filter = 'all' | LoanProductType;

/**
 * The whole financing picture, not a preview of it: what a lender sees when they look at this
 * business, every offer that came back, and what each one would do to the cash position. The
 * figures are underwritten from the same ledger the rest of the workspace reads.
 */
export default function FinancingPage() {
  const { companyId, version, notify } = useWorkspace();
  const [data, setData] = useState<LoanOffersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    try {
      const next = await api.cashflow.loans.offers(companyId, controller.signal);
      if (controller.signal.aborted) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof ApiError ? err.message : 'Could not load financing offers.');
    } finally {
      if (abort.current === controller) setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load, version]);
  useEffect(() => () => abort.current?.abort(), []);

  const replaceOffer = (offer: LoanOffer) =>
    setData((prev) => (prev ? { ...prev, offers: prev.offers.map((o) => (o.id === offer.id ? offer : o)) } : prev));

  const apply = async (offer: LoanOffer, amount: number) => {
    const updated = await api.cashflow.loans.apply(companyId, offer.id, amount);
    replaceOffer(updated);
    notify(`Application started with ${offer.lenderName} for ${money(amount)}.`);
  };

  const save = async (offer: LoanOffer) => {
    const updated = await api.cashflow.loans.save(companyId, offer.id);
    replaceOffer(updated);
    notify(updated.saved ? `${offer.product} saved for later.` : `${offer.product} removed from saved offers.`);
  };

  const types = useMemo(() => [...new Set(data?.offers.map((o) => o.type) ?? [])], [data]);
  const visible = useMemo(() => (data?.offers ?? []).filter((o) => filter === 'all' || o.type === filter), [data, filter]);
  const applications = data?.offers.filter((o) => o.application) ?? [];
  const saved = data?.offers.filter((o) => o.saved && !o.application) ?? [];

  if (error && !data) {
    return (
      <>
        <PageHeading title="Financing" />
        <Alert
          tone="danger"
          title="We couldn't load your offers"
          action={
            <Button size="sm" onClick={() => void load()} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
              Try again
            </Button>
          }
        >
          {error}
        </Alert>
      </>
    );
  }

  if (loading && !data) {
    return (
      <>
        <PageHeading title="Financing" />
        <div aria-busy="true" aria-label="Loading financing">
          <div className="skeleton h-44" />
          <div className="skeleton mt-5 h-28" />
          <div className="mt-5 space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skeleton h-32" />
            ))}
          </div>
        </div>
      </>
    );
  }

  if (!data) return null;

  return (
    <>
      <PageHeading
        title="Financing"
        aside={
          <Badge tone={TIER_TONE[data.profile.tier] ?? 'neutral'} title={data.profile.summary}>
            {data.profile.label} · {data.profile.score}/100
          </Badge>
        }
      >
        {data.headline} {data.subheadline}
      </PageHeading>

      <CreditProfileCard profile={data.profile} />

      {applications.length > 0 && (
        <section className="mt-5 rounded-2xl bg-panel p-5 shadow-card ring-1 ring-ink/5 sm:p-6" aria-label="Applications in progress">
          <h2 className="text-base font-semibold text-ink">Applications in progress</h2>
          <ul className="mt-3 divide-y divide-line">
            {applications.map((offer) => (
              <li key={offer.id} className="flex flex-wrap items-center gap-3 py-3">
                <InstitutionMark id={offer.lenderId} name={offer.lenderName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{offer.product}</p>
                  <p className="text-xs text-ink-muted">
                    {offer.lenderName} · requested {mediumDate(offer.application!.startedAt.slice(0, 10))}
                  </p>
                </div>
                <span className="tabular text-sm font-bold text-ink">{money(offer.application!.amount)}</span>
                <Badge tone="success">Started</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-5" aria-label="Offers">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-base font-semibold text-ink">
            {data.offers.length} offers from {new Set(data.offers.map((o) => o.lenderId)).size} lenders
          </h2>
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </FilterChip>
          {types.map((type) => (
            <FilterChip key={type} active={filter === type} onClick={() => setFilter(type)}>
              {TYPE_LABEL[type] ?? type}
            </FilterChip>
          ))}
        </div>

        <ul className="grid gap-3 lg:grid-cols-2">
          {visible.map((offer) => (
            <li key={offer.id}>
              <OfferCard
                offer={offer}
                onOpen={() => {
                  setSelectedId(offer.id);
                  setOpen(true);
                }}
                onSave={() => void save(offer)}
              />
            </li>
          ))}
        </ul>

        {visible.length === 0 && (
          <p className="rounded-2xl bg-panel p-8 text-center text-sm text-ink-muted shadow-card ring-1 ring-ink/5">
            No {filter === 'all' ? '' : (TYPE_LABEL[filter as LoanProductType] ?? '').toLowerCase()} offers right now. Offers
            refresh as your cash flow changes.
          </p>
        )}
      </section>

      <ComparisonTable offers={visible} />

      {saved.length > 0 && (
        <p className="mt-5 text-center text-xs text-ink-muted">
          {saved.length} offer{saved.length === 1 ? '' : 's'} saved for later.
        </p>
      )}

      {open && <FinancingDrawer data={data} selectedId={selectedId} onSelect={setSelectedId} onClose={() => setOpen(false)} onApply={apply} onSave={save} />}
    </>
  );
}

/** What a lender sees: the score, why it is what it is, and the figures behind it. */
function CreditProfileCard({ profile }: { profile: CreditProfile }) {
  const figures: Array<{ label: string; value: string; hint?: string }> = [
    { label: 'Annual revenue', value: money(profile.annualRevenue) },
    { label: 'Monthly revenue', value: money(profile.monthlyRevenue) },
    { label: 'Cash on hand', value: money(profile.totalCash) },
    { label: 'Cash buffer', value: `${profile.cashBufferMonths.toFixed(1)} months` },
    {
      label: profile.monthlyBurn > 0 ? 'Monthly burn' : 'Monthly surplus',
      value: money(Math.abs(profile.monthlyBurn)),
      hint: profile.monthlyBurn > 0 ? 'Spending more than it takes in' : 'Taking in more than it spends',
    },
    { label: 'Runway', value: profile.runwayMonths === null ? 'No burn' : `${profile.runwayMonths.toFixed(1)} months` },
    {
      label: 'Lowest projected cash',
      value: money(profile.lowestProjectedCash),
      hint: `in ${profile.monthsToLowest} month${profile.monthsToLowest === 1 ? '' : 's'}`,
    },
    { label: 'Existing debt service', value: `${money(profile.existingDebtService)}/mo` },
  ];

  return (
    <section className="rounded-2xl bg-panel p-5 shadow-card ring-1 ring-ink/5 sm:p-6" aria-label="Credit profile">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">How lenders see this business</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-secondary">{profile.summary}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="tabular text-3xl font-bold text-ink">{profile.score}</p>
          <p className="text-xs text-ink-muted">out of 100</p>
        </div>
      </div>

      <dl className="mt-5 grid gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-2 lg:grid-cols-4">
        {figures.map((figure) => (
          <div key={figure.label}>
            <dt className="text-xs font-medium text-ink-muted">{figure.label}</dt>
            <dd className="tabular mt-0.5 text-base font-bold text-ink">{figure.value}</dd>
            {figure.hint && <dd className="text-[11px] text-ink-muted">{figure.hint}</dd>}
          </div>
        ))}
      </dl>

      {profile.factors.length > 0 && (
        <ul className="mt-5 grid gap-2 border-t border-line pt-5 sm:grid-cols-2">
          {profile.factors.map((factor) => (
            <li key={factor.label} className="flex items-start gap-2 text-sm">
              {factor.impact === 'positive' ? (
                <TrendingUp className="mt-0.5 size-4 shrink-0 text-positive-600" aria-hidden="true" />
              ) : factor.impact === 'negative' ? (
                <TrendingDown className="mt-0.5 size-4 shrink-0 text-danger-600" aria-hidden="true" />
              ) : (
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
              )}
              <span className="min-w-0">
                <span className="font-medium text-ink">{factor.label}</span>{' '}
                <span className="text-ink-secondary">{factor.value}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OfferCard({ offer, onOpen, onSave }: { offer: LoanOffer; onOpen: () => void; onSave: () => void }) {
  return (
    <article
      className={cn(
        'flex h-full flex-col rounded-2xl bg-panel p-5 shadow-card ring-1 transition-shadow hover:shadow-float',
        offer.recommended ? 'ring-2 ring-brand-500' : 'ring-ink/5',
      )}
    >
      <div className="flex items-start gap-3">
        <InstitutionMark id={offer.lenderId} name={offer.lenderName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="truncate text-sm font-semibold text-ink">{offer.product}</h3>
            {offer.recommended && <Badge tone="brand">Recommended</Badge>}
            {offer.application && <Badge tone="success">Applied</Badge>}
          </div>
          <p className="truncate text-xs text-ink-muted">
            {offer.lenderName} · {TYPE_LABEL[offer.type] ?? offer.type}
          </p>
        </div>
        <button
          type="button"
          onClick={onSave}
          title={offer.saved ? 'Remove from saved' : 'Save for later'}
          className="shrink-0 rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink"
        >
          {offer.saved ? <BookmarkCheck className="size-4 text-brand-600" aria-hidden="true" /> : <Bookmark className="size-4" aria-hidden="true" />}
          <span className="sr-only">{offer.saved ? 'Remove from saved' : 'Save for later'}</span>
        </button>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-ink-secondary">{offer.fitReason}</p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
        <Figure label={offer.type === 'BUSINESS_CARD' ? 'Limit' : 'Up to'} value={money(offer.maxAmount)} />
        <Figure label="Rate" value={offer.rateLabel} />
        <Figure label="Term" value={offer.termLabel} />
        <Figure label="Funding" value={offer.fundingDays} />
        {offer.cost.monthlyPayment !== null && <Figure label="Monthly" value={`${money(offer.cost.monthlyPayment)}/mo`} />}
        <Figure label="Total cost" value={money(offer.cost.totalCost)} />
        {offer.impact.runwayMonthsAdded !== null && (
          <Figure label="Runway added" value={`+${offer.impact.runwayMonthsAdded.toFixed(1)} mo`} tone="positive" />
        )}
        <Figure label="Low point after" value={money(offer.impact.lowestProjectedCashAfter)} tone={offer.impact.lowestProjectedCashAfter < 0 ? 'negative' : 'positive'} />
      </dl>

      {offer.highlights.length > 0 && (
        <ul className="mt-4 space-y-1 text-xs text-ink-secondary">
          {offer.highlights.slice(0, 3).map((highlight) => (
            <li key={highlight} className="flex gap-1.5">
              <span aria-hidden="true" className="text-brand-600">
                ·
              </span>
              {highlight}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto pt-4">
        <Button size="sm" variant={offer.recommended ? 'primary' : 'secondary'} onClick={onOpen} iconRight={<ArrowRight className="size-4" aria-hidden="true" />}>
          {offer.application ? 'View application' : 'See details and apply'}
        </Button>
      </div>
    </article>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-ink-muted">{label}</dt>
      <dd className={cn('tabular text-sm font-bold', tone === 'positive' ? 'text-positive-700' : tone === 'negative' ? 'text-danger-700' : 'text-ink')}>{value}</dd>
    </div>
  );
}

/** Side by side, because the difference between two offers is the reason to pick one. */
function ComparisonTable({ offers }: { offers: LoanOffer[] }) {
  if (offers.length < 2) return null;
  return (
    <section className="mt-5 overflow-hidden rounded-2xl bg-panel shadow-card ring-1 ring-ink/5" aria-label="Offer comparison">
      <div className="border-b border-line p-5 sm:px-6">
        <h2 className="text-base font-semibold text-ink">Side by side</h2>
        <p className="mt-0.5 text-xs text-ink-muted">Cost figures assume the full amount is drawn and held for the term.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-surface/70 text-xs font-semibold text-ink-muted">
            <tr>
              {['Offer', 'Type', 'Amount', 'Rate', 'Term', 'Monthly', 'Total cost', 'Runway added'].map((heading) => (
                <th key={heading} scope="col" className="px-5 py-3 whitespace-nowrap">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {offers.map((offer) => (
              <tr key={offer.id} className={cn('align-top', offer.recommended && 'bg-brand-50/40')}>
                <td className="px-5 py-3">
                  <p className="font-semibold text-ink">{offer.product}</p>
                  <p className="text-xs text-ink-muted">{offer.lenderName}</p>
                </td>
                <td className="px-5 py-3 whitespace-nowrap text-ink-secondary">{TYPE_LABEL[offer.type] ?? offer.type}</td>
                <td className="tabular px-5 py-3 whitespace-nowrap font-semibold text-ink">{money(offer.maxAmount)}</td>
                <td className="px-5 py-3 whitespace-nowrap text-ink-secondary">{offer.rateLabel}</td>
                <td className="px-5 py-3 whitespace-nowrap text-ink-secondary">{offer.termLabel}</td>
                <td className="tabular px-5 py-3 whitespace-nowrap text-ink-secondary">
                  {offer.cost.monthlyPayment === null ? '—' : `${money(offer.cost.monthlyPayment)}/mo`}
                </td>
                <td className="tabular px-5 py-3 whitespace-nowrap text-ink-secondary">{money(offer.cost.totalCost)}</td>
                <td className="tabular px-5 py-3 whitespace-nowrap font-semibold text-positive-700">
                  {offer.impact.runwayMonthsAdded === null ? '—' : `+${offer.impact.runwayMonthsAdded.toFixed(1)} mo`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors',
        active ? 'bg-brand-600 text-white ring-brand-600' : 'bg-panel text-ink-secondary ring-line hover:bg-surface',
      )}
    >
      {children}
    </button>
  );
}
