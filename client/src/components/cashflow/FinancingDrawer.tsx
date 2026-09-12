import { Bookmark, BookmarkCheck, Check, ChevronLeft, CircleCheck, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { costOfOffer, estimateImpact } from '../../../../shared/lending.ts';
import type { LoanOffer, LoanOffersResponse } from '../../../../shared/types.ts';
import { ApiError } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { mediumDate, money } from '../../lib/format.ts';
import { Badge, type BadgeTone } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { Field, inputClass } from './FormControls.tsx';
import { InstitutionMark } from './InstitutionMark.tsx';

const TIER_TONE: Record<string, BadgeTone> = { A: 'success', B: 'brand', C: 'neutral' };
const IMPACT_TONE = { positive: 'text-positive-700', neutral: 'text-ink-secondary', negative: 'text-danger-600' } as const;

interface Props {
  data: LoanOffersResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  onApply: (offer: LoanOffer, amount: number) => Promise<void>;
  onSave: (offer: LoanOffer) => Promise<void>;
}

export function FinancingDrawer({ data, selectedId, onSelect, onClose, onApply, onSave }: Props) {
  const id = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mobileDetail, setMobileDetail] = useState(selectedId !== null);
  const offer = data.offers.find((o) => o.id === selectedId) ?? null;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <div className="animate-fade-in absolute inset-0 bg-navy-950/40" onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="animate-slide-in absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col bg-panel shadow-float">
        <header className="flex items-start justify-between gap-3 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-lg font-bold text-ink">
              Financing offers
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">{data.subheadline}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-secondary transition-colors hover:bg-surface hover:text-ink">
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[280px_minmax(0,1fr)]">
          <nav className={cn('min-h-0 overflow-y-auto border-line md:border-r', mobileDetail && 'hidden md:block')} aria-label="Offers">
            <div className="border-b border-line px-4 py-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-ink-secondary">Your credit profile</p>
                <Badge tone={TIER_TONE[data.profile.tier] ?? 'neutral'}>
                  {data.profile.label} · {data.profile.score}
                </Badge>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{data.profile.summary}</p>
              <dl className="mt-3 space-y-1.5">
                {data.profile.factors.map((f) => (
                  <div key={f.label} className="flex items-baseline justify-between gap-2 text-xs">
                    <dt className="text-ink-muted">{f.label}</dt>
                    <dd className={cn('tabular text-right font-medium', IMPACT_TONE[f.impact])}>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <ul className="p-2">
              {data.offers.map((o) => {
                const active = o.id === selectedId;
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(o.id);
                        setMobileDetail(true);
                      }}
                      aria-current={active ? 'true' : undefined}
                      className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface', active && 'bg-brand-50/70 hover:bg-brand-50')}
                    >
                      <InstitutionMark id={o.lenderId} name={o.lenderName} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">{o.product}</span>
                        <span className="block truncate text-xs text-ink-muted">
                          {o.lenderName} · {o.type === 'BUSINESS_CARD' ? 'limit' : 'up to'} {money(o.maxAmount, { compact: true })}
                        </span>
                      </span>
                      {o.application ? <CircleCheck className="size-4 shrink-0 text-positive-600" aria-label="Application started" /> : o.recommended ? <Badge tone="brand">Top pick</Badge> : o.saved ? <BookmarkCheck className="size-4 shrink-0 text-ink-muted" aria-label="Saved" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className={cn('min-h-0 overflow-y-auto', !mobileDetail && 'hidden md:block')}>
            {offer ? (
              <OfferDetail key={offer.id} offer={offer} data={data} onApply={onApply} onSave={onSave} onBack={() => setMobileDetail(false)} />
            ) : (
              <p className="p-6 text-sm text-ink-muted">Choose an offer to see the terms.</p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function OfferDetail({ offer, data, onApply, onSave, onBack }: { offer: LoanOffer; data: LoanOffersResponse; onApply: (offer: LoanOffer, amount: number) => Promise<void>; onSave: (offer: LoanOffer) => Promise<void>; onBack: () => void }) {
  const id = useId();
  const [amountText, setAmountText] = useState(String(offer.application?.amount ?? offer.amount));
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = Number(amountText);
  const valid = Number.isFinite(amount) && amount >= offer.minAmount && amount <= offer.maxAmount;
  const { cost, impact } = useMemo(() => {
    const safe = valid ? amount : offer.amount;
    const c = costOfOffer(offer.pricing, safe);
    return { cost: c, impact: estimateImpact(data.profile, c, safe) };
  }, [amount, valid, offer, data.profile]);

  const card = offer.type === 'BUSINESS_CARD';
  const revolving = offer.pricing.kind === 'revolving';
  const applied = offer.application;

  const apply = async () => {
    if (!valid) {
      setError(`Choose an amount between ${money(offer.minAmount)} and ${money(offer.maxAmount)}.`);
      return;
    }
    setApplying(true);
    setError(null);
    try {
      await onApply(offer, Math.round(amount));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the application.');
    } finally {
      setApplying(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(offer);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the offer.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-6 py-5">
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-ink-secondary hover:text-ink md:hidden">
        <ChevronLeft className="size-4" aria-hidden="true" /> All offers
      </button>
      <div className="flex items-start gap-3">
        <InstitutionMark id={offer.lenderId} name={offer.lenderName} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-lg leading-tight font-bold text-ink">
            {offer.product}
            {offer.recommended && <Badge tone="brand">Recommended</Badge>}
            {applied && <Badge tone="success">Application started</Badge>}
          </p>
          <p className="mt-0.5 text-sm text-ink-muted">
            {offer.lenderName} · {offer.termLabel}
          </p>
        </div>
      </div>

      <p className="mt-4 rounded-xl bg-brand-50/70 p-3.5 text-sm leading-relaxed text-brand-900 ring-1 ring-brand-100">{offer.fitReason}</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Field label={card ? 'Credit limit' : 'Amount'} htmlFor={`${id}-amount`} hint={applied ? `Requested ${mediumDate(applied.startedAt.slice(0, 10))}` : `Between ${money(offer.minAmount)} and ${money(offer.maxAmount)}`} error={!valid && !applied ? 'Outside the offered range' : null}>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-muted">$</span>
            <input
              id={`${id}-amount`}
              type="number"
              inputMode="numeric"
              min={offer.minAmount}
              max={offer.maxAmount}
              step={1000}
              value={amountText}
              disabled={applied !== null}
              onChange={(e) => setAmountText(e.target.value)}
              className={`${inputClass} pl-7 tabular`}
            />
          </div>
        </Field>
        <div className="rounded-xl bg-surface p-3.5">
          <p className="text-xs font-semibold text-ink-secondary">{impact.runwayMonthsAdded !== null ? 'Runway impact' : 'Cash position impact'}</p>
          {impact.runwayMonthsAdded !== null ? (
            <>
              <p className="tabular mt-1 text-[22px] leading-none font-bold text-ink">
                {impact.runwayMonthsAdded >= 0 ? '+' : ''}
                {impact.runwayMonthsAdded.toFixed(1)} months
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                From {data.profile.runwayMonths?.toFixed(1)} to {((data.profile.runwayMonths ?? 0) + impact.runwayMonthsAdded).toFixed(1)} months at today’s burn
              </p>
            </>
          ) : (
            <>
              <p className="tabular mt-1 text-[22px] leading-none font-bold text-ink">{money(impact.lowestProjectedCashAfter)}</p>
              <p className="mt-1 text-xs text-ink-muted">Lowest projected cash, up from {money(data.profile.lowestProjectedCash)}</p>
            </>
          )}
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Term label="Rate" value={offer.rateLabel} />
        <Term label="Funding" value={offer.fundingDays} />
        <Term label={revolving ? 'Monthly interest if fully drawn' : offer.pricing.kind === 'revenue_share' ? 'Typical monthly remittance' : 'Monthly payment'} value={cost.monthlyPayment === null ? (card ? 'Pay in full monthly' : '—') : money(cost.monthlyPayment)} />
        <Term label={revolving ? 'Cost over a year, fully drawn' : card ? 'Annual fee' : 'Total cost of borrowing'} value={money(cost.totalCost)} />
        <Term label="Total repayment" value={card ? '—' : money(cost.totalRepayment)} />
        <Term label="Payoff" value={cost.payoffMonths ? `${cost.payoffMonths} months` : revolving ? 'Revolving' : card ? 'Monthly statement' : '—'} />
      </dl>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold text-ink-secondary">Highlights</p>
          <ul className="mt-2 space-y-1.5">
            {offer.highlights.map((h) => (
              <li key={h} className="flex items-start gap-2 text-sm text-ink">
                <Check className="mt-0.5 size-4 shrink-0 text-positive-600" aria-hidden="true" />
                {h}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold text-ink-secondary">Requirements</p>
          <ul className="mt-2 space-y-1.5">
            {offer.requirements.map((r) => (
              <li key={r} className="flex items-start gap-2 text-sm text-ink-secondary">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-ink-muted" aria-hidden="true" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {applied && (
        <div className="mt-5 rounded-xl bg-positive-50 p-4 ring-1 ring-positive-100">
          <p className="text-sm font-semibold text-positive-700">Application started on {mediumDate(applied.startedAt.slice(0, 10))}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-secondary">
            {applied.nextSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {!applied && (
          <Button onClick={() => void apply()} loading={applying} disabled={!valid}>
            Start application
          </Button>
        )}
        <Button variant="secondary" onClick={() => void save()} loading={saving} icon={offer.saved ? <BookmarkCheck className="size-4" aria-hidden="true" /> : <Bookmark className="size-4" aria-hidden="true" />}>
          {offer.saved ? 'Saved' : 'Save for later'}
        </Button>
        <p className="ml-auto text-xs text-ink-muted">Sample offer. Terms are illustrative, not a commitment to lend.</p>
      </div>
    </div>
  );
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd className="tabular mt-0.5 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}
