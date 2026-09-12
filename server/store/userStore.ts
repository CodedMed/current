import { randomUUID } from 'node:crypto';
import type { BusinessTypeId, FeatureId, IdentityStatus, IntegrationMode } from '../../shared/types.ts';

export interface AuthProfile {
  provider: 'google';
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  givenName: string;
  familyName: string;
  picture: string | null;
}

export interface IdentityState {
  mode: IntegrationMode;
  status: IdentityStatus;
  inquiryId: string | null;
  /** Reviewer comment / failure reason surfaced to the user when present. */
  detail: string | null;
  updatedAt: string | null;
}

export interface OnboardingState {
  businessType: BusinessTypeId | null;
  features: FeatureId[];
  completedAt: string | null;
}

export interface WorkspaceState {
  mode: IntegrationMode;
  businessName: string;
  nessieCustomerId: string;
  accountIds: string[];
  /** Merchant names/categories created during provisioning, keyed by Nessie merchant id. */
  merchants: Record<string, { name: string; category: string }>;
  /** False when the banking API left balances untouched by the seeded transactions. */
  balancesApplied: boolean;
  provisionedAt: string;
}

export interface UserRecord {
  id: string;
  provider: 'google';
  providerSubject: string;
  email: string;
  name: string;
  givenName: string;
  familyName: string;
  picture: string | null;
  createdAt: string;
  identity: IdentityState;
  onboarding: OnboardingState;
  workspace: WorkspaceState | null;
}

/**
 * Persistence boundary. The in-memory implementation is enough for the demo;
 * a database-backed implementation only needs to satisfy this interface.
 */
export interface UserRepository {
  get(id: string): Promise<UserRecord | null>;
  findByProviderSubject(provider: 'google', subject: string): Promise<UserRecord | null>;
  findByInquiryId(inquiryId: string): Promise<UserRecord | null>;
  upsertFromProfile(profile: AuthProfile, identityMode: IntegrationMode): Promise<UserRecord>;
  update(id: string, mutate: (user: UserRecord) => void): Promise<UserRecord>;
}

export class InMemoryUserRepository implements UserRepository {
  readonly #users = new Map<string, UserRecord>();

  async get(id: string): Promise<UserRecord | null> {
    return this.#users.get(id) ?? null;
  }

  async findByProviderSubject(provider: 'google', subject: string): Promise<UserRecord | null> {
    for (const user of this.#users.values()) {
      if (user.provider === provider && user.providerSubject === subject) return user;
    }
    return null;
  }

  async findByInquiryId(inquiryId: string): Promise<UserRecord | null> {
    for (const user of this.#users.values()) {
      if (user.identity.inquiryId === inquiryId) return user;
    }
    return null;
  }

  async upsertFromProfile(profile: AuthProfile, identityMode: IntegrationMode): Promise<UserRecord> {
    const existing = await this.findByProviderSubject(profile.provider, profile.subject);
    if (existing) {
      existing.email = profile.email;
      existing.name = profile.name;
      existing.givenName = profile.givenName;
      existing.familyName = profile.familyName;
      existing.picture = profile.picture;
      return existing;
    }
    const user: UserRecord = {
      id: randomUUID(),
      provider: profile.provider,
      providerSubject: profile.subject,
      email: profile.email,
      name: profile.name,
      givenName: profile.givenName,
      familyName: profile.familyName,
      picture: profile.picture,
      createdAt: new Date().toISOString(),
      identity: { mode: identityMode, status: 'not_started', inquiryId: null, detail: null, updatedAt: null },
      onboarding: { businessType: null, features: [], completedAt: null },
      workspace: null,
    };
    this.#users.set(user.id, user);
    return user;
  }

  async update(id: string, mutate: (user: UserRecord) => void): Promise<UserRecord> {
    const user = this.#users.get(id);
    if (!user) throw new Error(`User ${id} not found`);
    mutate(user);
    return user;
  }
}
