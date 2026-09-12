import { Check, NotebookPen, Pencil, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { CashAccount, CashCategory, CashTransaction, ReviewDecision } from '../../../../shared/types.ts';
import { ApiError, api } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { fullDate, mediumDate, money, paymentMethodLabel, titleCase } from '../../lib/format.ts';
import { Badge, type BadgeTone } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { Field, inputClass, selectClass, textareaClass } from './FormControls.tsx';

interface Props {
  txn: CashTransaction | null;
  companyId: string;
  accounts: CashAccount[];
  categories: CashCategory[];
  onClose: () => void;
  onSaved: (txn: CashTransaction) => void;
  onDecide: (txn: CashTransaction, decision: ReviewDecision) => Promise<void>;
}

const STATUS_TONE: Record<CashTransaction['status'], BadgeTone> = {
  POSTED: 'success',
  PENDING: 'warning',
  SCHEDULED: 'brand',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

export function TransactionDrawer({ txn, companyId, accounts, categories, onClose, onSaved, onDecide }: Props) {
  const open = txn !== null;
  const id = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ merchant: '', description: '', categoryId: '', note: '' });
  const [deciding, setDeciding] = useState<ReviewDecision | null>(null);

  useEffect(() => {
    if (!txn) return;
    setEditing(false);
    setError(null);
    setForm({ merchant: txn.merchant, description: txn.description, categoryId: txn.categoryId, note: txn.note ?? '' });
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
  }, [txn, onClose]);

  if (!txn) return null;

  const inflow = txn.direction === 'INFLOW';
  const account = accounts.find((a) => a.id === txn.accountId);
  const categoryName = categories.find((c) => c.id === txn.categoryId)?.name ?? txn.categoryId;
  const editable = categories.filter((c) => c.parentId === (inflow ? 'income' : 'expenses'));

  const decide = async (decision: ReviewDecision) => {
    setDeciding(decision);
    try {
      await onDecide(txn, decision);
    } finally {
      setDeciding(null);
    }
  };

  const startEdit = (focusNote = false) => {
    setEditing(true);
    if (focusNote) window.setTimeout(() => noteRef.current?.focus(), 0);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = await api.cashflow.updateTransaction(companyId, txn.id, {
        merchant: form.merchant,
        description: form.description,
        categoryId: form.categoryId,
        note: form.note.trim() ? form.note : null,
      });
      setEditing(false);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <div className="animate-fade-in absolute inset-0 bg-navy-950/40" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="animate-slide-in absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-panel shadow-float"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink-muted">{inflow ? 'Money in' : 'Money out'}</p>
            <h2 id={`${id}-title`} className="mt-0.5 truncate text-lg font-bold text-ink">
              {txn.merchant}
            </h2>
            <p className={cn('tabular mt-1 text-[28px] leading-none font-bold tracking-tight', inflow ? 'text-positive-700' : 'text-ink')}>
              {inflow ? '+' : '−'}
              {money(txn.amount, { cents: true })}
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-secondary transition-colors hover:bg-surface hover:text-ink">
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {editing ? (
            <form id={`${id}-form`} onSubmit={(e) => void submit(e)} className="space-y-4">
              <Field label="Merchant" htmlFor={`${id}-merchant`}>
                <input id={`${id}-merchant`} className={inputClass} value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} required maxLength={80} />
              </Field>
              <Field label="Description" htmlFor={`${id}-description`}>
                <input id={`${id}-description`} className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={200} />
              </Field>
              <Field label="Category" htmlFor={`${id}-category`}>
                <select id={`${id}-category`} className={selectClass} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  {editable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Note" htmlFor={`${id}-note`} hint="Visible only to your team.">
                <textarea id={`${id}-note`} ref={noteRef} className={textareaClass} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={500} placeholder="Why this matters, who approved it, what to check next time…" />
              </Field>
              {error && (
                <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
                  {error}
                </p>
              )}
            </form>
          ) : (
            <>
            {txn.review && (
              <section className={cn('mb-4 rounded-xl p-4 ring-1 ring-inset', txn.review.status === 'open' ? 'bg-warning-50 ring-warning-100' : 'bg-surface ring-line')} aria-label="Review">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {txn.review.reason === 'possible_duplicate' ? 'Possible duplicate charge' : txn.review.deviation > 0 ? 'Higher than this vendor usually bills' : 'Lower than this vendor usually bills'}
                  <Badge tone={txn.review.status === 'open' ? 'warning' : txn.review.status === 'approved' ? 'success' : 'neutral'}>
                    {txn.review.status === 'open' ? 'Needs review' : txn.review.status === 'approved' ? 'Confirmed' : 'Disputed'}
                  </Badge>
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
                  {txn.review.reason === 'possible_duplicate'
                    ? `An identical ${money(txn.review.expected, { cents: true })} charge from ${txn.merchant} posted within a few days of this one.`
                    : `${txn.merchant} usually bills about ${money(txn.review.expected)} (normal range ${money(txn.review.typicalLow)}–${money(txn.review.typicalHigh)}, based on ${txn.review.sampleSize} bills). This one is ${Math.abs(Math.round(txn.review.deviationPct))}% ${txn.review.deviation > 0 ? 'higher' : 'lower'}.`}
                </p>
                {txn.review.status === 'open' ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => void decide('approve')} loading={deciding === 'approve'} disabled={deciding !== null && deciding !== 'approve'} icon={<Check className="size-4" aria-hidden="true" />}>
                      Looks right
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void decide('dispute')} loading={deciding === 'dispute'} disabled={deciding !== null && deciding !== 'dispute'} icon={<X className="size-4" aria-hidden="true" />}>
                      Dispute
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                    {txn.review.status === 'approved' ? 'Confirmed' : 'Disputed'}
                    {txn.review.resolvedAt ? ` on ${mediumDate(txn.review.resolvedAt.slice(0, 10))}` : ''}
                    <button type="button" onClick={() => void decide('reopen')} disabled={deciding !== null} className="font-semibold text-brand-700 hover:underline">
                      Reopen
                    </button>
                  </p>
                )}
              </section>
            )}
            <dl className="divide-y divide-line">
              <Row label="Date" value={fullDate(txn.date)} />
              <Row label="Status" value={<Badge tone={STATUS_TONE[txn.status]}>{titleCase(txn.status)}</Badge>} />
              {txn.postedDate && txn.postedDate !== txn.date && <Row label="Posted" value={fullDate(txn.postedDate)} />}
              <Row label="Account" value={account ? `${account.name}${account.mask ? ` •••• ${account.mask}` : ''}` : txn.accountId} />
              <Row label="Category" value={categoryName} />
              <Row label="Payment method" value={paymentMethodLabel(txn.paymentMethod)} />
              <Row label="Description" value={txn.description} />
              <Row label="Source" value={txn.source === 'BANK_SYNC' ? 'Bank sync' : txn.source === 'MANUAL' ? 'Added manually' : 'Forecast'} />
              <Row label="Note" value={txn.note ? <span className="whitespace-pre-wrap">{txn.note}</span> : <span className="text-ink-muted">No note yet</span>} />
            </dl>
            </>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" type="submit" form={`${id}-form`} loading={saving}>
                Save changes
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={() => startEdit(true)} icon={<NotebookPen className="size-4" aria-hidden="true" />}>
                {txn.note ? 'Edit note' : 'Add note'}
              </Button>
              <Button size="sm" onClick={() => startEdit(false)} icon={<Pencil className="size-4" aria-hidden="true" />}>
                Edit
              </Button>
            </>
          )}
        </footer>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-3">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}
