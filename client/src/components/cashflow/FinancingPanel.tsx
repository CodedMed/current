import { ArrowRight, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LoanOffer, LoanOffersResponse } from '../../../../shared/types.ts';
import { ApiError, api } from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { Badge, type BadgeTone } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { FinancingDrawer } from './FinancingDrawer.tsx';
import { InstitutionMark } from './InstitutionMark.tsx';
import { EmptyState, Panel } from './Panel.tsx';

const SHOW = 3;
const TIER_TONE: Record<string, BadgeTone> = { A: 'success', B: 'brand', C: 'neutral' };

interface Props {
  companyId: string;
  /** Bumps when the ledger changes so offers are re-underwritten. */
  version: number;
  onToast: (message: string) => void;
}

/** Loan offers underwritten from the company's own ledger. Owns its data and the details drawer. */
export function FinancingPanel({ companyId, version, onToast }: Props) {
  const [data, setData] = useState<LoanOffersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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

  const replaceOffer = (offer: LoanOffer) => setData((prev) => (prev ? { ...prev, offers: prev.offers.map((o) => (o.id === offer.id ? offer : o)) } : prev));

  const apply = async (offer: LoanOffer, amount: number) => {
    const updated = await api.cashflow.loans.apply(companyId, offer.id, amount);
    replaceOffer(updated);
    onToast(`Application started with ${offer.lenderName} for ${money(amount)}.`);
  };

  const save = async (offer: LoanOffer) => {
    const updated = await api.cashflow.loans.save(companyId, offer.id);
    replaceOffer(updated);
    onToast(updated.saved ? `${offer.product} saved for later.` : `${offer.product} removed from saved offers.`);
  };

  const openDrawer = (id: string | null) => {
    setSelectedId(id ?? data?.offers[0]?.id ?? null);
    setOpen(true);
  };

  const featured = data?.offers.slice(0, SHOW) ?? [];
  const applied = data?.offers.filter((o) => o.application).length ?? 0;

  return (
    <>
      <Panel
        id="financing"
        title="Financing offers"
        subtitle={data ? data.headline : 'Matched to your cash flow'}
        aside={data ? <Badge tone={TIER_TONE[data.profile.tier] ?? 'neutral'} title={data.profile.summary}>{data.profile.label} · {data.profile.score}</Badge> : undefined}
        bodyClassName="pt-3"
        footer={
          data && data.offers.length > 0 ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-ink-muted">{applied > 0 ? `${applied} application${applied === 1 ? '' : 's'} started` : `${data.offers.length} offers from ${new Set(data.offers.map((o) => o.lenderId)).size} lenders`}</span>
              <Button size="sm" variant="ghost" onClick={() => openDrawer(null)} iconRight={<ArrowRight className="size-4" aria-hidden="true" />}>
                See all offers
              </Button>
            </div>
          ) : undefined
        }
      >
        {error && !data ? (
          <EmptyState>
            {error}{' '}
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">
              <RefreshCw className="size-3.5" aria-hidden="true" /> Try again
            </button>
          </EmptyState>
        ) : loading && !data ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading offers">
            {Array.from({ length: SHOW }, (_, i) => (
              <div key={i} className="skeleton h-[72px]" />
            ))}
          </div>
        ) : data && featured.length === 0 ? (
          <EmptyState>No offers match right now. Offers refresh as your cash flow changes.</EmptyState>
        ) : (
          <>
            {data && <p className="mb-3 text-sm leading-relaxed text-ink-secondary">{data.subheadline}</p>}
            <ul className="space-y-1.5">
              {featured.map((offer) => (
                <li key={offer.id}>
                  <button type="button" onClick={() => openDrawer(offer.id)} className="flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-surface">
                    <InstitutionMark id={offer.lenderId} name={offer.lenderName} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="truncate text-sm font-semibold text-ink">{offer.product}</span>
                        {offer.recommended && <Badge tone="brand">Recommended</Badge>}
                        {offer.application && <Badge tone="success">Application started</Badge>}
                        {offer.saved && !offer.application && <Badge tone="neutral">Saved</Badge>}
                      </span>
                      <span className="block truncate text-xs text-ink-muted">
                        {offer.lenderName} · {offer.rateLabel}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-ink-secondary">{offer.fitReason}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="tabular block text-sm font-bold text-ink">{money(offer.application?.amount ?? offer.maxAmount)}</span>
                      <span className="block text-[11px] text-ink-muted">{offer.application ? 'requested' : offer.type === 'BUSINESS_CARD' ? 'limit' : 'up to'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      {open && data && <FinancingDrawer data={data} selectedId={selectedId} onSelect={setSelectedId} onClose={() => setOpen(false)} onApply={apply} onSave={save} />}
    </>
  );
}
