/**
 * The onboarding journey, in order. Both the server (which decides where a user
 * may go next) and the client (which renders progress and guards routes) read
 * from this single definition.
 */
export const FLOW_STEPS = [
  'signup',
  'verify',
  'business-type',
  'features',
  'setup',
  'dashboard',
] as const;

export type FlowStep = (typeof FLOW_STEPS)[number];

export const FLOW_STEP_PATHS: Record<FlowStep, string> = {
  signup: '/',
  verify: '/verify',
  'business-type': '/onboarding/business-type',
  features: '/onboarding/features',
  setup: '/onboarding/setup',
  dashboard: '/dashboard',
};

export function stepIndex(step: FlowStep): number {
  return FLOW_STEPS.indexOf(step);
}

export function pathForStep(step: FlowStep): string {
  return FLOW_STEP_PATHS[step];
}

/** Steps shown in the progress indicator (the dashboard is the destination, not a step). */
export const PROGRESS_STEPS: ReadonlyArray<{ step: FlowStep; label: string; hint: string }> = [
  { step: 'signup', label: 'Create account', hint: 'Sign in with a provider' },
  { step: 'verify', label: 'Verify identity', hint: 'KYC / AML check' },
  // Parked for now: verified users go straight to the dashboard (see server/flow.ts).
  // { step: 'business-type', label: 'Business profile', hint: 'What you operate' },
  // { step: 'features', label: 'Priorities', hint: 'What you need to manage' },
  // { step: 'setup', label: 'Workspace', hint: 'Connect financial data' },
];
