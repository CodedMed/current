import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { PAYMENT_METHODS, type CashAccount, type CashCategory, type CashTransaction, type FlowDirection, type PaymentMethod } from '../../../../shared/types.ts';
import { ApiError, api } from '../../lib/api.ts';
import { paymentMethodLabel } from '../../lib/format.ts';
import { Button } from '../ui/Button.tsx';
import { Field, inputClass, selectClass } from './FormControls.tsx';
import { Segmented } from './Segmented.tsx';

interface Props {
  open: boolean;
  companyId: string;
  accounts: CashAccount[];
  categories: CashCategory[];
  today: string;
  onClose: () => void;
  onAdded: (txn: CashTransaction) => void;
}

export function AddTransactionDialog({ open, companyId, accounts, categories, today, onClose, onAdded }: Props) {
  const id = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const [direction, setDirection] = useState<FlowDirection>('OUTFLOW');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('ACH');
  const [merchant, setMerchant] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bankAccounts = accounts.filter((a) => a.type !== 'PAYMENT_PROCESSOR');
  const options = categories.filter((c) => c.parentId === (direction === 'INFLOW' ? 'income' : 'expenses'));
  const scheduled = date > today;

  useEffect(() => {
    if (!open) return;
    setDirection('OUTFLOW');
    setAmount('');
    setDate(today);
    setAccountId(bankAccounts[0]?.id ?? '');
    setCategoryId('');
    setMethod('ACH');
    setMerchant('');
    setDescription('');
    setError(null);
    const previous = document.activeElement as HTMLElement | null;
    window.setTimeout(() => firstRef.current?.focus(), 0);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!options.some((c) => c.id === categoryId)) setCategoryId(options[0]?.id ?? '');
  }, [direction, options, categoryId]);

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const txn = await api.cashflow.addTransaction(companyId, {
        accountId,
        date,
        direction,
        amount: Math.round(value * 100) / 100,
        merchant: merchant.trim(),
        description: description.trim() || undefined,
        categoryId,
        paymentMethod: method,
        status: scheduled ? 'SCHEDULED' : 'POSTED',
      });
      onAdded(txn);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the transaction.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" role="presentation">
      <div className="animate-fade-in absolute inset-0 bg-navy-950/40" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="animate-scale-in relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-2xl bg-panel shadow-float sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-line px-6 py-5">
          <div>
            <h2 id={`${id}-title`} className="text-lg font-bold text-ink">
              Add transaction
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">Record money that moved, or schedule something that will.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-secondary transition-colors hover:bg-surface hover:text-ink">
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <form id={`${id}-form`} onSubmit={(e) => void submit(e)} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <Segmented
            label="Direction"
            options={[
              { id: 'OUTFLOW', label: 'Money out' },
              { id: 'INFLOW', label: 'Money in' },
            ]}
            value={direction}
            onChange={setDirection}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount" htmlFor={`${id}-amount`}>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-muted">$</span>
                <input
                  ref={firstRef}
                  id={`${id}-amount`}
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={`${inputClass} pl-7`}
                  placeholder="0.00"
                />
              </div>
            </Field>
            <Field label="Date" htmlFor={`${id}-date`} hint={scheduled ? 'After today, so it will be saved as scheduled.' : 'Today or earlier posts immediately.'}>
              <input id={`${id}-date`} type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </Field>
          </div>
          <Field label={direction === 'INFLOW' ? 'Received from' : 'Paid to'} htmlFor={`${id}-merchant`}>
            <input id={`${id}-merchant`} required maxLength={80} value={merchant} onChange={(e) => setMerchant(e.target.value)} className={inputClass} placeholder={direction === 'INFLOW' ? 'Customer or source' : 'Vendor or payee'} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Account" htmlFor={`${id}-account`}>
              <select id={`${id}-account`} required value={accountId} onChange={(e) => setAccountId(e.target.value)} className={selectClass}>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.mask ? ` •••• ${a.mask}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Category" htmlFor={`${id}-category`}>
              <select id={`${id}-category`} required value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={selectClass}>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payment method" htmlFor={`${id}-method`}>
              <select id={`${id}-method`} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={selectClass}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {paymentMethodLabel(m)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description" htmlFor={`${id}-description`}>
              <input id={`${id}-description`} maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} placeholder="Optional" />
            </Field>
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
              {error}
            </p>
          )}
        </form>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form={`${id}-form`} loading={saving}>
            {scheduled ? 'Schedule' : 'Add transaction'}
          </Button>
        </footer>
      </div>
    </div>
  );
}
