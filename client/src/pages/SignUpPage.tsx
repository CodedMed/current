import { ArrowRight, Mail } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { OnboardingShell } from '../components/layout/OnboardingShell.tsx';
import { Alert } from '../components/ui/Alert.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { AppleIcon, GoogleIcon, MicrosoftIcon } from '../components/ui/ProviderIcons.tsx';
import { Spinner } from '../components/ui/Spinner.tsx';
import { cn } from '../lib/cn.ts';
import { useSession } from '../lib/session.tsx';

const AUTH_ERRORS: Record<string, string> = {
  access_denied: 'You cancelled Google sign-in before it finished. Nothing was changed.',
  state_mismatch: 'That sign-in link expired or was already used. Please start again.',
  expired: 'That sign-in took too long and expired. Please start again.',
  exchange_failed: 'Google sign-in could not be completed. Please try again in a moment.',
  provider_error: 'Google returned an error during sign-in. Please try again.',
};

type Provider = 'google' | 'microsoft' | 'apple' | 'email';

const PLACEHOLDER_COPY: Record<Exclude<Provider, 'google'>, string> = {
  microsoft: 'Microsoft sign-in is not connected in this demo yet. Continue with Google to see the full flow.',
  apple: 'Apple sign-in is not connected in this demo yet. Continue with Google to see the full flow.',
  email: 'Email sign-up is not connected in this demo yet. Continue with Google to see the full flow.',
};

export default function SignUpPage() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const authError = params.get('auth_error');
  const errorMessage = authError ? (AUTH_ERRORS[authError] ?? 'Sign-in did not complete. Please try again.') : null;
  const googleMode = session?.integrations.google ?? 'live';

  useEffect(() => {
    if (!authError) return;
    const timer = window.setTimeout(() => {
      params.delete('auth_error');
      setParams(params, { replace: true });
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [authError, params, setParams]);

  const placeholder = (provider: Exclude<Provider, 'google'>) => {
    setNotice(PLACEHOLDER_COPY[provider]);
  };

  return (
    <OnboardingShell
      step="signup"
      eyebrow="Welcome to Keel"
      title="Create your account"
      description="Start with the sign-in you already use. Identity verification and workspace setup take about five minutes."
    >
      <div className="space-y-3">
        {errorMessage && <Alert tone="danger" title="Sign-in didn't complete">{errorMessage}</Alert>}
        {googleMode === 'sandbox' && (
          <Alert tone="warning" title="Google sign-in is running in sandbox mode">
            No Google OAuth credentials are configured, so a demo Google account will be used. Add <code className="rounded bg-warning-100 px-1 py-0.5 text-xs">GOOGLE_CLIENT_ID</code> and{' '}
            <code className="rounded bg-warning-100 px-1 py-0.5 text-xs">GOOGLE_CLIENT_SECRET</code> to switch to real sign-in.
          </Alert>
        )}
        {notice && (
          <Alert tone="info" title="Coming soon">
            {notice}
          </Alert>
        )}
      </div>

      <div className={cn('mt-6 space-y-3', (errorMessage || notice || googleMode === 'sandbox') && 'mt-5')}>
        <a
          href="/api/auth/google"
          onClick={() => setStarting(true)}
          aria-busy={starting || undefined}
          className={cn(
            'group animate-fade-up stagger-1 flex h-14 w-full items-center gap-3 rounded-xl bg-panel px-4 text-left font-semibold text-ink shadow-card ring-1 ring-brand-200 transition-all',
            'hover:ring-brand-400 hover:shadow-float focus-visible:ring-brand-500',
            starting && 'pointer-events-none opacity-70',
          )}
        >
          <span className="grid size-9 place-items-center rounded-lg bg-surface">{starting ? <Spinner className="size-5 text-brand-600" /> : <GoogleIcon />}</span>
          <span className="flex-1">Continue with Google</span>
          {googleMode === 'sandbox' && <Badge tone="warning">Sandbox</Badge>}
          <ArrowRight className="size-4 text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </a>

        <ProviderButton delay={2} icon={<MicrosoftIcon />} onClick={() => placeholder('microsoft')} disabled={starting}>
          Continue with Microsoft
        </ProviderButton>
        <ProviderButton delay={3} icon={<AppleIcon className="size-5 text-ink" />} onClick={() => placeholder('apple')} disabled={starting}>
          Continue with Apple
        </ProviderButton>
        <ProviderButton delay={4} icon={<Mail className="size-5 text-ink-secondary" aria-hidden="true" />} onClick={() => placeholder('email')} disabled={starting}>
          Continue with Email
        </ProviderButton>
      </div>

      <p className="animate-fade-up stagger-5 mt-8 text-center text-xs leading-relaxed text-ink-muted">
        By continuing you agree to Keel's{' '}
        <a href="#" className="font-medium text-ink-secondary underline decoration-line underline-offset-2 hover:text-ink">
          Terms of Service
        </a>{' '}
        and{' '}
        <a href="#" className="font-medium text-ink-secondary underline decoration-line underline-offset-2 hover:text-ink">
          Privacy Policy
        </a>
        . We never move money without your approval.
      </p>
    </OnboardingShell>
  );
}

function ProviderButton({ icon, children, onClick, disabled, delay }: { icon: ReactNode; children: ReactNode; onClick: () => void; disabled?: boolean; delay: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        `animate-fade-up stagger-${delay} flex h-14 w-full items-center gap-3 rounded-xl bg-panel px-4 text-left font-semibold text-ink shadow-ring transition-all`,
        'hover:shadow-[0_0_0_1px_var(--color-line-strong)] hover:bg-surface/60 disabled:opacity-60',
      )}
    >
      <span className="grid size-9 place-items-center rounded-lg bg-surface">{icon}</span>
      <span className="flex-1">{children}</span>
      <Badge tone="neutral">Soon</Badge>
    </button>
  );
}
