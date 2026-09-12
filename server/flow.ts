import type { FlowStep } from '../shared/flow.ts';
import type { IdentityStatus, PublicUser, SessionResponse } from '../shared/types.ts';
import type { AppConfig } from './config.ts';
import type { UserRecord } from './store/userStore.ts';

/**
 * The server is the single authority on where a user is in the journey. The
 * client only renders what it is told and redirects to `nextStep`.
 */

export function isIdentityVerified(status: IdentityStatus, acceptCompleted: boolean): boolean {
  return status === 'approved' || (acceptCompleted && status === 'completed');
}

export function acceptCompletedPolicy(config: AppConfig): boolean {
  // Sandbox identity decisions are explicit, so `completed` only matters for live Persona.
  return config.persona?.acceptCompleted ?? true;
}

export function computeNextStep(user: UserRecord | null, config: AppConfig): FlowStep {
  if (!user) return 'signup';
  if (!isIdentityVerified(user.identity.status, acceptCompletedPolicy(config))) return 'verify';
  // Business profile, priorities, and Nessie workspace setup are parked for now:
  // once identity is verified the journey lands on the dashboard, which is served
  // by the mock cash-flow API. Restore these lines to bring the steps back.
  // if (!user.onboarding.businessType) return 'business-type';
  // if (user.onboarding.features.length === 0) return 'features';
  // if (!user.workspace) return 'setup';
  return 'dashboard';
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    givenName: user.givenName,
    picture: user.picture,
    identity: {
      status: user.identity.status,
      inquiryId: user.identity.inquiryId,
      updatedAt: user.identity.updatedAt,
    },
    onboarding: {
      businessType: user.onboarding.businessType,
      features: [...user.onboarding.features],
    },
    workspace: user.workspace
      ? { provisioned: true, mode: user.workspace.mode, businessName: user.workspace.businessName }
      : null,
  };
}

export function toSessionResponse(user: UserRecord | null, config: AppConfig): SessionResponse {
  return {
    user: user ? toPublicUser(user) : null,
    integrations: config.integrations,
    nextStep: computeNextStep(user, config),
  };
}
