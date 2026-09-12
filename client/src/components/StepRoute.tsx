import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { pathForStep, stepIndex, type FlowStep } from '../../../shared/flow.ts';
import type { SessionResponse } from '../../../shared/types.ts';
import { useSession } from '../lib/session.tsx';
import { FullScreenError, FullScreenLoader } from './FullScreenState.tsx';

/**
 * Decides whether the current user may see `step`. The server's `nextStep` is
 * authoritative; this only translates it into a redirect.
 */
export function resolveRedirect(step: FlowStep, session: SessionResponse): string | null {
  const next = session.nextStep;
  if (step === 'signup') return session.user ? pathForStep(next) : null;
  if (!session.user) return pathForStep('signup');
  switch (step) {
    case 'verify':
    case 'setup':
    case 'dashboard':
      return next === step ? null : pathForStep(next);
    default:
      // Onboarding questions may be revisited until the workspace exists.
      if (next === 'verify' || next === 'dashboard') return pathForStep(next);
      return stepIndex(next) >= stepIndex(step) ? null : pathForStep(next);
  }
}

export function StepRoute({ step, children }: { step: FlowStep; children: ReactNode }) {
  const { session, loading, error, refresh } = useSession();
  if (loading) return <FullScreenLoader label="Loading your workspace…" />;
  if (!session) return <FullScreenError message={error?.message ?? 'Something went wrong while loading your session.'} onRetry={() => void refresh()} />;
  const redirect = resolveRedirect(step, session);
  if (redirect) return <Navigate to={redirect} replace />;
  return <>{children}</>;
}
