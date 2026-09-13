import { Check, FileText, RefreshCw, Search, ShieldCheck, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { CopilotInvoice, DocumentUploadStage, SavedDocumentResult } from '../../../shared/copilot.ts';
import { inputClass } from '../components/cashflow/FormControls.tsx';
import { CopilotPageShell } from '../components/layout/CopilotPageShell.tsx';
import { Alert } from '../components/ui/Alert.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Button, buttonClasses } from '../components/ui/Button.tsx';
import { Spinner } from '../components/ui/Spinner.tsx';
import { ApiError, api } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { mediumDate, money, titleCase } from '../lib/format.ts';

const STAGES = [
  { id: 'uploading', label: 'Uploading' },
  { id: 'extracting', label: 'Extracting locally' },
  { id: 'validating', label: 'Validating' },
  { id: 'scoring', label: 'Checking risk' },
  { id: 'saved', label: 'Saved' },
] as const;

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function DocumentsPage() {
  const [invoices, setInvoices] = useState<CopilotInvoice[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadLock = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<DocumentUploadStage | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedDocumentResult | null>(null);
  const [scoringId, setScoringId] = useState<string | null>(null);
  /** How many invoices the automatic check is working through, 0 when it is not running. */
  const [checking, setChecking] = useState(0);
  const backfilled = useRef(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestVersion = useRef(0);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const next = await api.copilot.invoices(signal);
      if (signal?.aborted || version !== requestVersion.current) return;
      setInvoices(next);
      setListError(null);
    } catch (error) {
      if (signal?.aborted || version !== requestVersion.current) return;
      setListError(messageOf(error, 'Could not load invoices. Please try again.'));
    } finally {
      if (!signal?.aborted && version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  /**
   * Every invoice gets checked, without being asked. Invoices arrive unscored from the bank feed
   * and from the vendor history, and an unchecked invoice is the one a bad charge hides in — so
   * the page scores them itself the first time it sees any, then reloads to show the verdicts.
   */
  useEffect(() => {
    if (invoices === null || backfilled.current) return;
    const pending = invoices.filter((invoice) => invoice.riskScore === null).length;
    if (pending === 0) return;
    backfilled.current = true;

    const controller = new AbortController();
    setChecking(pending);
    void (async () => {
      try {
        const result = await api.copilot.backfillRisk(controller.signal);
        if (controller.signal.aborted) return;
        if (result.scored > 0) await refresh(controller.signal);
        // More than one request may score: keep going until nothing is left unchecked.
        if (result.remaining > 0) backfilled.current = false;
      } catch {
        // Leave them unchecked and let the per-row control stand; this is not worth an error.
        backfilled.current = false;
      } finally {
        if (!controller.signal.aborted) setChecking(0);
      }
    })();
    return () => controller.abort();
  }, [invoices, refresh]);

  const selectFile = (files: FileList | null) => {
    if (uploadLock.current || !files?.length) return;
    setUploadError(null);
    setSaved(null);
    setStage(null);
    setFile(null);
    if (files.length !== 1) {
      setUploadError('Choose one invoice at a time.');
      return;
    }
    const next = files[0]!;
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(next.type) || next.size === 0 || next.size > 10 * 1024 * 1024) {
      setUploadError('Choose a nonempty PDF, PNG, or JPEG up to 10 MB.');
      return;
    }
    setFile(next);
  };

  const upload = async () => {
    if (!file || uploadLock.current) return;
    uploadLock.current = true;
    setUploading(true);
    setUploadError(null);
    setSaved(null);
    try {
      const result = await api.copilot.uploadDocument(file, setStage);
      setSaved(result);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      // The saved response may have an invoice snapshot from before its automatic risk check.
      const invoice = result.risk ? { ...result.invoice, riskScore: result.risk.riskScore, riskSeverity: result.risk.severity, riskReasons: result.risk.reasons } : result.invoice;
      setInvoices((previous) => [invoice, ...(previous ?? []).filter((item) => item.id !== invoice.id)]);
    } catch (error) {
      setStage('error');
      setUploadError(messageOf(error, 'The upload did not finish. Check the invoice list before uploading again.'));
    } finally {
      uploadLock.current = false;
      setUploading(false);
      void refresh();
    }
  };

  const score = async (invoice: CopilotInvoice) => {
    if (scoringId) return;
    setScoringId(invoice.id);
    setScoreError(null);
    try {
      const risk = await api.copilot.scoreInvoice(invoice.id);
      setInvoices((previous) => previous?.map((item) => item.id === invoice.id ? { ...item, riskScore: risk.riskScore, riskSeverity: risk.severity, riskReasons: risk.reasons } : item) ?? null);
    } catch (error) {
      setScoreError(messageOf(error, 'Could not check invoice risk. Please try again.'));
    } finally {
      setScoringId(null);
    }
  };

  const visible = (invoices ?? []).filter((invoice) => `${invoice.vendorDisplayName ?? invoice.vendorKey} ${invoice.status} ${invoice.riskSeverity ?? ''} ${invoice.riskReasons.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const stageIndex = STAGES.findIndex((item) => item.id === stage);

  return (
    <CopilotPageShell title="Documents & invoices" description="Turn vendor invoices into upcoming obligations, check unusual charges, and see their effect on your cash flow.">
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl bg-panel p-5 shadow-card ring-1 ring-ink/5 sm:p-6" aria-labelledby="upload-heading">
          <h2 id="upload-heading" className="text-base font-semibold text-ink">Upload a vendor invoice</h2>
          <p className="mt-1 text-sm text-ink-secondary">Saving an invoice adds its payment to your forecast.</p>
          <div className={cn('mt-4 rounded-xl border-2 border-dashed px-5 py-6 text-center transition-colors', dragging ? 'border-brand-500 bg-brand-50' : 'border-line-strong bg-surface/50')}
            onDragOver={(event) => { event.preventDefault(); if (!uploading) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files); }}>
            <Upload className="mx-auto size-7 text-brand-600" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-ink">Drop an invoice here</p>
            <p className="mt-1 text-xs text-ink-muted">PDF, PNG, or JPEG · Up to 10 MB</p>
            <input ref={inputRef} type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" aria-label="Choose invoice file" disabled={uploading} onChange={(event) => selectFile(event.target.files)} />
            <Button className="mt-3" variant="secondary" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>Choose file</Button>
          </div>
          {file && <p className="mt-3 flex items-center gap-2 text-sm text-ink"><FileText className="size-4 shrink-0 text-ink-muted" aria-hidden="true" /><span className="min-w-0 break-all">{file.name}</span><span className="ml-auto shrink-0 text-xs text-ink-muted">{(file.size / 1024).toFixed(0)} KB</span></p>}
          <Button className="mt-4" full onClick={() => void upload()} disabled={!file} loading={uploading} icon={<Upload className="size-4" aria-hidden="true" />}>{uploading ? 'Processing invoice…' : 'Upload & save invoice'}</Button>
          {stage && stage !== 'error' && <ol className="mt-4 flex flex-wrap gap-x-3 gap-y-2" aria-label="Upload progress" aria-live="polite">{STAGES.map((item, index) => <li key={item.id} aria-current={index === stageIndex ? 'step' : undefined} className={cn('inline-flex items-center gap-1 text-xs', index <= stageIndex ? 'font-semibold text-brand-700' : 'text-ink-muted')}>{index < stageIndex || stage === 'saved' ? <Check className="size-3" aria-hidden="true" /> : index === stageIndex ? <Spinner className="size-3" /> : null}{item.label}</li>)}</ol>}
          {uploadError && <Alert tone="danger" className="mt-4">{uploadError}</Alert>}
          <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-ink-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />Processed locally by the document service; raw document text is not sent to Gemini. Only extracted financial facts are saved.</p>
        </section>

        <section className="rounded-2xl bg-panel p-5 shadow-card ring-1 ring-ink/5 sm:p-6" aria-labelledby="extraction-heading">
          <h2 id="extraction-heading" className="text-base font-semibold text-ink">Extracted details</h2>
          {saved ? <>
            <p className="mt-1 text-sm font-medium text-positive-700" role="status">Invoice saved and added to your obligations.</p>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Detail label="Vendor" value={saved.extraction.vendorDisplayName ?? saved.extraction.vendorKey} />
              <Detail label="Amount" value={money(saved.extraction.amount, { cents: true })} />
              <Detail label="Invoice date" value={saved.extraction.invoiceDate ? mediumDate(saved.extraction.invoiceDate) : 'Not found'} />
              <Detail label="Due date" value={saved.extraction.dueDate ? mediumDate(saved.extraction.dueDate) : 'Not found'} />
              <Detail label="Category" value={titleCase(saved.extraction.category)} />
              <Detail label="Recurring" value={saved.extraction.recurring ? 'Yes' : 'No'} />
              <Detail label="Extraction confidence" value={`${Math.round(saved.extraction.confidence * 100)}%`} />
              <Detail label="Risk" value={saved.risk ? `${titleCase(saved.risk.severity)} · ${Math.round(saved.risk.riskScore * 100)}/100` : 'Not checked yet'} />
            </dl>
            {saved.warnings.length > 0 && <Alert tone="warning" className="mt-4"><ul className="list-disc space-y-1 pl-4">{saved.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></Alert>}
            {saved.forecast && <p className="mt-4 rounded-xl bg-surface p-3 text-sm text-ink-secondary">{saved.forecast.firstGapDate && saved.forecast.firstGapAmount !== null ? <>Projected shortfall: <strong className="text-danger-700">{money(saved.forecast.firstGapAmount)} on {mediumDate(saved.forecast.firstGapDate.slice(0, 10))}</strong>.</> : <>No projected cash shortfall in the next {saved.forecast.horizonDays} days.</>}</p>}
            <div className="mt-4 flex flex-wrap gap-2"><Link to="/dashboard" className={buttonClasses('secondary', 'sm')}>View cash flow</Link><Link to="/advisor" className={buttonClasses('primary', 'sm')}>Ask the advisor</Link></div>
          </> : <div className="grid min-h-60 place-content-center text-center"><FileText className="mx-auto size-10 text-ink-muted/50" aria-hidden="true" /><p className="mt-3 text-sm text-ink-secondary">Your extracted invoice details will appear here.</p><p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-muted">Review the saved amount, due date, and any warnings before acting on an invoice.</p></div>}
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl bg-panel shadow-card ring-1 ring-ink/5" aria-labelledby="invoices-heading">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-5 sm:px-6">
          <div className="mr-auto"><h2 id="invoices-heading" className="text-base font-semibold text-ink">Invoice history {invoices && <span className="ml-1 text-sm font-normal text-ink-muted">{invoices.length}</span>}</h2><p className="mt-0.5 text-xs text-ink-muted">Every invoice is checked automatically. Risk scores describe unusual patterns, not proof of fraud.</p></div>
          {checking > 0 && <span className="flex items-center gap-2 text-xs font-medium text-brand-700" role="status"><Spinner className="size-3.5" />Checking {checking} invoice{checking === 1 ? '' : 's'} for risk…</span>}
          <div className="relative w-full sm:w-64"><Search className="absolute top-3 left-3 size-4 text-ink-muted" aria-hidden="true" /><input aria-label="Search invoices" placeholder="Search vendor, status, risk…" value={query} onChange={(event) => setQuery(event.target.value)} className={cn(inputClass, 'pl-9')} /></div>
          <Button variant="secondary" size="sm" loading={loading} onClick={() => void refresh()} icon={<RefreshCw className="size-4" aria-hidden="true" />}>Refresh</Button>
        </div>
        {listError && <Alert tone="danger" className="m-5" action={<Button size="sm" variant="secondary" onClick={() => void refresh()}>Retry loading invoices</Button>}>{listError}</Alert>}
        {scoreError && <Alert tone="danger" className="m-5">{scoreError}</Alert>}
        {loading && !invoices ? <p className="flex items-center justify-center gap-2 p-12 text-sm text-ink-muted" role="status"><Spinner className="size-4" />Loading invoices…</p> : invoices && visible.length === 0 ? <p className="p-12 text-center text-sm text-ink-muted">{query ? 'No invoices match your search.' : 'No invoices yet. Upload your first vendor invoice above.'}</p> : invoices && <div className="overflow-x-auto"><table className="w-full min-w-[840px] text-left text-sm"><thead className="bg-surface/70 text-xs font-semibold text-ink-muted"><tr>{['Vendor', 'Amount', 'Due', 'Status', 'Risk', 'Reason', ''].map((heading) => <th key={heading} scope="col" className="px-5 py-3">{heading}</th>)}</tr></thead><tbody className="divide-y divide-line">{visible.map((invoice) => <tr key={invoice.id} id={`invoice-${invoice.id}`} className="scroll-mt-[calc(var(--workspace-header,9rem)+1rem)] align-top">
          <td className="max-w-48 px-5 py-4"><p className="break-words font-semibold text-ink">{invoice.vendorDisplayName ?? titleCase(invoice.vendorKey)}</p><p className="mt-1 text-xs text-ink-muted">{invoice.recurring ? 'Recurring' : titleCase(invoice.source)}</p></td>
          <td className="whitespace-nowrap px-5 py-4 tabular font-semibold text-ink">{money(invoice.amount, { cents: true })}</td>
          <td className="whitespace-nowrap px-5 py-4 text-ink-secondary">{invoice.dueDate ? mediumDate(invoice.dueDate) : 'Not provided'}</td>
          <td className="px-5 py-4"><Badge tone={invoice.status === 'OVERDUE' ? 'danger' : invoice.status === 'PAID' ? 'success' : 'neutral'}>{titleCase(invoice.status)}</Badge></td>
          <td className="px-5 py-4">{invoice.riskSeverity ? <><Badge tone={invoice.riskSeverity === 'HIGH' ? 'danger' : invoice.riskSeverity === 'MEDIUM' ? 'warning' : 'success'}>{titleCase(invoice.riskSeverity)}</Badge><p className="mt-1 text-xs text-ink-muted">{Math.round((invoice.riskScore ?? 0) * 100)}/100 anomaly score</p></> : checking > 0 ? <span className="flex items-center gap-1.5 text-xs text-ink-muted"><Spinner className="size-3" />Checking…</span> : <Badge tone="neutral">Not checked</Badge>}</td>
          <td className="max-w-80 min-w-48 px-5 py-4 text-xs leading-relaxed text-ink-secondary">{invoice.riskReasons.length ? <ul className="space-y-1">{invoice.riskReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : invoice.riskScore !== null ? 'No unusual patterns detected.' : 'Run a risk check to compare this invoice with its vendor history.'}</td>
          <td className="px-5 py-4"><Button size="sm" variant="secondary" loading={scoringId === invoice.id} disabled={loading || uploading || checking > 0 || (scoringId !== null && scoringId !== invoice.id)} onClick={() => void score(invoice)} aria-label={`Recheck risk for ${invoice.vendorDisplayName ?? invoice.vendorKey}`}>Recheck</Button></td>
        </tr>)}</tbody></table></div>}
      </section>
    </CopilotPageShell>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-0.5 break-words font-semibold text-ink">{value}</dd></div>;
}
