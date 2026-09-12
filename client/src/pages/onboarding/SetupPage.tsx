import { ArrowLeft, ArrowRight, Check, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { PROVISION_STAGES, type ProvisionStage, type ProvisionStatus } from '../../../../shared/types.ts';
import { OnboardingShell } from '../../components/layout/OnboardingShell.tsx';
import { Alert } from '../../components/ui/Alert.tsx';
import { ModeBadge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { Spinner } from '../../components/ui/Spinner.tsx';
import { SuccessCheck } from '../../components/ui/SuccessCheck.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { useSession } from '../../lib/session.tsx';

const STAGE_COPY: Record<ProvisionStage, { title: string; detail: string }> = {
  workspace: { title: 'Creating your workspace', detail: 'Registering your business with the banking sandbox' },
  accounts: { title: 'Connecting accounts', detail: 'Operating checking, reserve savings, and business card' },
  transactions: { title: 'Importing 90 days of activity', detail: 'Deposits, purchases, payroll, and transfers' },
  bills: { title: 'Scheduling bills and invoices', detail: 'Recurring bills, vendor invoices, and receivables' },
  analysis: { title: 'Building your cash-flow picture', detail: 'Balances, categories, and a 30-day forecast' },
};

const POLL_MS = 600;
const STAGE_DWELL_MS = 550;

export default function SetupPage() {
  const { session, refresh } = useSession();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ProvisionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(0); // stages visually completed (paced for legibility)
  const timer = useRef<number | null>(null);
  const mode = session?.integrations.nessie ?? 'live';

  const stopPolling = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
  };

  const start = useCallback(async () => {
    setError(null);
    setStatus(null);
    setShown(0);
    stopPolling();
    try {
      const first = await api.onboarding.provision();
      setStatus(first);
      if (first.state === 'running') {
        timer.current = window.setInterval(async () => {
          try {
            const next = await api.onboarding.provisionStatus();
            setStatus(next);
            if (next.state !== 'running') stopPolling();
          } catch (err) {
            stopPolling();
            setError(err instanceof ApiError ? err.message : 'Lost contact with the server while setting up.');
          }
        }, POLL_MS);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start workspace setup.');
    }
  }, []);

  useEffect(() => {
    void start();
    return stopPolling;
  }, [start]);

  // Pace the visual progress so each stage is readable even when the backend is instant.
  const actualCompleted = status?.state === 'done' ? PROVISION_STAGES.length : (status?.completed.length ?? 0);
  useEffect(() => {
    if (shown >= actualCompleted) return;
    const t = window.setTimeout(() => setShown((s) => s + 1), STAGE_DWELL_MS);
    return () => window.clearTimeout(t);
  }, [shown, actualCompleted]);

  const finished = status?.state === 'done' && shown >= PROVISION_STAGES.length;
  const failed = status?.state === 'error' || error !== null;

  useEffect(() => {
    if (!finished) return;
    const t = window.setTimeout(async () => {
      await refresh();
      navigate('/dashboard', { replace: true });
    }, 1400);
    return () => window.clearTimeout(t);
  }, [finished, navigate, refresh]);

  return (
    <OnboardingShell
      step="setup"
      eyebrow="Step 5 · Workspace"
      title={finished ? 'Your workspace is ready' : 'Setting up your workspace'}
      description={
        finished
          ? 'Your accounts, activity, and first forecast are in place.'
          : 'We are pulling your financial data from the banking API and preparing your dashboard. Hang tight; this takes under a minute.'
      }
      footer={
        failed ? (
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" onClick={() => navigate('/onboarding/features')} icon={<ArrowLeft className="size-4" aria-hidden="true" />}>
              Back to priorities
            </Button>
            <Button onClick={() => void start()} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
              Try again
            </Button>
          </div>
        ) : finished ? (
          <div className="flex justify-end">
            <Button
              size="lg"
              onClick={async () => {
                await refresh();
                navigate('/dashboard', { replace: true });
              }}
              iconRight={<ArrowRight className="size-4" aria-hidden="true" />}
            >
              Open dashboard
            </Button>
          </div>
        ) : undefined
      }
    >
      <Card>
        <div className="mb-5 flex items-center justify-between">
          <span className="text-sm font-semibold text-ink">Nessie banking data</span>
          <ModeBadge mode={mode} service="Nessie" />
        </div>

        {failed ? (
          <Alert tone="danger" title="Setup didn't finish">
            {error ?? status?.error ?? 'The banking API returned an error.'} Nothing was lost; you can safely try again.
          </Alert>
        ) : finished ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <SuccessCheck />
            <div>
              <p className="text-lg font-bold text-ink">All set</p>
              <p className="mt-1 text-sm text-ink-secondary">Opening your dashboard…</p>
            </div>
          </div>
        ) : (
          <ol className="space-y-1" aria-live="polite">
            {PROVISION_STAGES.map((stage, i) => {
              const done = i < shown;
              const active = i === shown;
              const copy = STAGE_COPY[stage];
              return (
                <li key={stage} className={cn('flex items-center gap-3.5 rounded-xl px-3 py-3 transition-colors', active && 'bg-brand-50/70')}>
                  <span
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-full transition-all',
                      done && 'bg-positive-500 text-white',
                      active && 'bg-panel text-brand-600 shadow-ring',
                      !done && !active && 'bg-surface text-ink-muted',
                    )}
                  >
                    {done ? <Check className="size-4" strokeWidth={3} aria-hidden="true" /> : active ? <Spinner className="size-4" /> : <span className="text-xs font-bold">{i + 1}</span>}
                  </span>
                  <span className="min-w-0">
                    <span className={cn('block text-sm font-semibold', done || active ? 'text-ink' : 'text-ink-muted')}>{copy.title}</span>
                    <span className={cn('block text-xs', active ? 'text-ink-secondary' : 'text-ink-muted')}>{copy.detail}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </OnboardingShell>
  );
}
