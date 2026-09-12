import { ArrowRight, Camera, Clock, IdCard, RefreshCw, ShieldCheck } from 'lucide-react';
import Persona from 'persona';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { IdentityStatusResponse, SandboxIdentityOutcome } from '../../../shared/types.ts';
import { OnboardingShell } from '../components/layout/OnboardingShell.tsx';
import { Alert } from '../components/ui/Alert.tsx';
import { ModeBadge } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Spinner } from '../components/ui/Spinner.tsx';
import { SuccessCheck } from '../components/ui/SuccessCheck.tsx';
import { ApiError, api } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';

type Phase =
  | 'preparing'
  | 'ready'
  | 'open'
  | 'checking'
  | 'deciding'
  | 'approved'
  | 'declined'
  | 'needs_review'
  | 'failed'
  | 'cancelled'
  | 'error';

const DECISION_POLL_MS = 2500;
const REVIEW_POLL_MS = 8000;

export default function VerifyIdentityPage() {
  const { session, refresh } = useSession();
  const [phase, setPhase] = useState<Phase>('preparing');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clientRef = useRef<InstanceType<typeof Persona.Client> | null>(null);
  const credentials = useRef<{ inquiryId: string; sessionToken: string } | null>(null);
  const preparing = useRef(false);
  const mode = session?.integrations.persona ?? 'live';

  const destroyClient = useCallback(() => {
    clientRef.current?.destroy();
    clientRef.current = null;
  }, []);

  /** Applies a status response to the local phase. Verified users are moved along by the route guard. */
  const applyStatus = useCallback(
    async (status: IdentityStatusResponse) => {
      setMessage(status.detail);
      if (status.nextStep !== 'verify') {
        setPhase('approved');
        window.setTimeout(() => void refresh(), 1400);
        return;
      }
      switch (status.status) {
        case 'declined':
          setPhase('declined');
          break;
        case 'needs_review':
          setPhase('needs_review');
          break;
        case 'failed':
        case 'expired':
          setPhase('failed');
          break;
        case 'completed':
          setPhase('deciding');
          break;
        default:
          setPhase('ready');
      }
    },
    [refresh],
  );

  const prepare = useCallback(async () => {
    if (preparing.current) return; // React StrictMode mounts effects twice in development
    preparing.current = true;
    setPhase('preparing');
    setMessage(null);
    destroyClient();
    try {
      const started = await api.identity.start();
      if (started.nextStep !== 'verify') {
        setPhase('approved');
        window.setTimeout(() => void refresh(), 1400);
        return;
      }
      if (started.mode === 'sandbox') {
        await applyStatus({ status: started.status, inquiryId: started.inquiryId, nextStep: started.nextStep, detail: null });
        if (started.status === 'pending' || started.status === 'created' || started.status === 'not_started') setPhase('ready');
        return;
      }
      if (started.sessionToken && started.inquiryId) {
        credentials.current = { inquiryId: started.inquiryId, sessionToken: started.sessionToken };
        setPhase('ready');
        return;
      }
      await applyStatus({ status: started.status, inquiryId: started.inquiryId, nextStep: started.nextStep, detail: null });
    } catch (err) {
      setPhase('error');
      setMessage(err instanceof ApiError ? err.message : 'We could not start verification. Please try again.');
    } finally {
      preparing.current = false;
    }
  }, [applyStatus, destroyClient, refresh]);

  useEffect(() => {
    void prepare();
    return destroyClient;
  }, [prepare, destroyClient]);

  // Poll while a decision or manual review is outstanding.
  useEffect(() => {
    if (phase !== 'deciding' && phase !== 'needs_review') return;
    const interval = phase === 'deciding' ? DECISION_POLL_MS : REVIEW_POLL_MS;
    const timer = window.setInterval(async () => {
      try {
        const status = await api.identity.status();
        if (status.status !== 'completed' || status.nextStep !== 'verify') await applyStatus(status);
      } catch {
        /* keep polling; transient errors are not fatal here */
      }
    }, interval);
    return () => window.clearInterval(timer);
  }, [phase, applyStatus]);

  const confirm = useCallback(
    async (inquiryId: string) => {
      setPhase('checking');
      try {
        await applyStatus(await api.identity.complete(inquiryId));
      } catch (err) {
        setPhase('error');
        setMessage(err instanceof ApiError ? err.message : 'We could not confirm your verification result.');
      }
    },
    [applyStatus],
  );

  const openPersona = () => {
    const creds = credentials.current;
    if (!creds) {
      void prepare();
      return;
    }
    setBusy(true);
    destroyClient();
    const client = new Persona.Client({
      inquiryId: creds.inquiryId,
      sessionToken: creds.sessionToken,
      onReady: () => {
        setBusy(false);
        setPhase('open');
        client.open();
      },
      onComplete: ({ inquiryId }) => {
        destroyClient();
        void confirm(inquiryId);
      },
      onCancel: () => {
        destroyClient();
        setPhase('cancelled');
      },
      onError: (error) => {
        destroyClient();
        setBusy(false);
        setPhase('error');
        setMessage(error.message ?? `Persona reported an error (${error.code}).`);
      },
    });
    clientRef.current = client;
  };

  const simulate = async (outcome: SandboxIdentityOutcome) => {
    setBusy(true);
    try {
      setPhase('checking');
      await applyStatus(await api.identity.simulate(outcome));
    } catch (err) {
      setPhase('error');
      setMessage(err instanceof ApiError ? err.message : 'Sandbox decision failed.');
    } finally {
      setBusy(false);
    }
  };

  const checkStatus = async () => {
    setBusy(true);
    try {
      await applyStatus(await api.identity.status());
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not refresh status.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingShell
      step="verify"
      eyebrow="Step 2 · Identity"
      title="Verify your identity"
      description="Financial regulations require us to confirm who you are before your business can move money through Keel. It takes about two minutes."
    >
      <Card className="relative overflow-hidden">
        <div className="mb-5 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <ShieldCheck className="size-5 text-brand-600" aria-hidden="true" />
            KYC / AML check · secured by Persona
          </span>
          <ModeBadge mode={mode} service="Persona" />
        </div>

        {phase === 'preparing' && (
          <div className="flex flex-col items-center gap-3 py-10 text-center" role="status" aria-live="polite">
            <Spinner className="size-7 text-brand-600" />
            <p className="text-sm font-medium text-ink">Preparing your secure session…</p>
            <p className="text-xs text-ink-muted">Creating an inquiry with Persona</p>
          </div>
        )}

        {phase === 'ready' && (
          <div className="space-y-5">
            <ul className="grid gap-3 sm:grid-cols-3">
              <Requirement icon={<IdCard className="size-5" aria-hidden="true" />} title="Government ID" body="Driver's license, passport, or national ID" />
              <Requirement icon={<Camera className="size-5" aria-hidden="true" />} title="A camera" body="For a quick selfie match" />
              <Requirement icon={<Clock className="size-5" aria-hidden="true" />} title="Two minutes" body="Most people finish faster" />
            </ul>
            {mode === 'live' ? (
              <Button size="lg" full onClick={openPersona} loading={busy} iconRight={<ArrowRight className="size-4" aria-hidden="true" />}>
                Begin verification
              </Button>
            ) : (
              <SandboxPanel busy={busy} onChoose={(o) => void simulate(o)} />
            )}
            <p className="text-center text-xs text-ink-muted">Your documents go directly to Persona. Keel only receives the result.</p>
          </div>
        )}

        {phase === 'open' && (
          <Status spinner title="Verification in progress" body="Complete the steps in the secure Persona window. This page updates automatically when you finish." />
        )}
        {phase === 'checking' && <Status spinner title="Confirming your result…" body="Checking the outcome with Persona." />}
        {phase === 'deciding' && (
          <Status spinner title="Documents submitted" body="Persona is finishing its automated checks. This usually takes a few seconds; we will move you along as soon as a decision arrives." />
        )}

        {phase === 'approved' && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <SuccessCheck />
            <div>
              <p className="text-lg font-bold text-ink">You're verified</p>
              <p className="mt-1 text-sm text-ink-secondary">Opening your dashboard…</p>
            </div>
            <Button variant="secondary" onClick={() => void refresh()} iconRight={<ArrowRight className="size-4" aria-hidden="true" />}>
              Continue now
            </Button>
          </div>
        )}

        {phase === 'cancelled' && (
          <Alert
            tone="info"
            title="You exited before finishing"
            action={
              <Button size="sm" onClick={() => void prepare()} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
                Resume verification
              </Button>
            }
          >
            No problem. Your progress is saved with Persona, so you can pick up where you left off.
          </Alert>
        )}

        {phase === 'needs_review' && (
          <Alert
            tone="warning"
            title="Your verification needs a manual review"
            action={
              <Button size="sm" variant="secondary" onClick={() => void checkStatus()} loading={busy} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
                Check status
              </Button>
            }
          >
            A specialist is taking a closer look, usually within one business day. We will email you the moment it is done.
            {message && <p className="mt-2 text-xs opacity-80">{message}</p>}
          </Alert>
        )}

        {phase === 'declined' && (
          <Alert tone="danger" title="We couldn't verify your identity">
            Based on the information provided, we are unable to open a Keel account right now.
            {message && <p className="mt-2 text-xs opacity-80">{message}</p>}
            <p className="mt-2">
              If you believe this is a mistake, contact{' '}
              <a href="mailto:support@keel.app" className="font-semibold underline underline-offset-2">
                support@keel.app
              </a>
              .
            </p>
          </Alert>
        )}

        {phase === 'failed' && (
          <Alert
            tone="danger"
            title="Verification didn't complete"
            action={
              <Button size="sm" onClick={() => void prepare()} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
                Try again
              </Button>
            }
          >
            {message ?? 'The session expired or too many attempts were made. Start a fresh verification to continue.'}
          </Alert>
        )}

        {phase === 'error' && (
          <Alert
            tone="danger"
            title="Something went wrong"
            action={
              <Button size="sm" onClick={() => void prepare()} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
                Try again
              </Button>
            }
          >
            {message ?? 'We could not reach the verification service.'}
          </Alert>
        )}
      </Card>
    </OnboardingShell>
  );
}

function Requirement({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <li className="rounded-xl bg-surface p-3.5">
      <span className="mb-2 grid size-9 place-items-center rounded-lg bg-panel text-brand-700 shadow-ring">{icon}</span>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">{body}</p>
    </li>
  );
}

function Status({ title, body, spinner }: { title: string; body: string; spinner?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center" role="status" aria-live="polite">
      {spinner && <Spinner className="size-7 text-brand-600" />}
      <p className="text-base font-semibold text-ink">{title}</p>
      <p className="max-w-sm text-sm leading-relaxed text-ink-secondary">{body}</p>
    </div>
  );
}

function SandboxPanel({ busy, onChoose }: { busy: boolean; onChoose: (outcome: SandboxIdentityOutcome) => void }) {
  return (
    <div className="rounded-xl border border-dashed border-warning-500/50 bg-warning-50/60 p-4">
      <p className="text-sm font-semibold text-warning-700">Persona sandbox</p>
      <p className="mt-1 text-xs leading-relaxed text-warning-700/90">
        No Persona API key is configured, so the embedded flow cannot open. Choose an outcome to simulate the verification result. The rest of the app behaves exactly as it
        would with a real decision.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Button size="sm" onClick={() => onChoose('approved')} loading={busy}>
          Simulate approval
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onChoose('needs_review')} disabled={busy}>
          Simulate manual review
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onChoose('declined')} disabled={busy}>
          Simulate decline
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onChoose('failed')} disabled={busy}>
          Simulate failure
        </Button>
      </div>
    </div>
  );
}
