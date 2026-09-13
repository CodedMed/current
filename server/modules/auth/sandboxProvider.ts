import { randomBytes } from 'node:crypto';
import type { AuthProfile } from '../../store/userStore.ts';
import type { AuthCallbackParams, AuthProvider, AuthorizationRequest } from './types.ts';

/**
 * Stand-in used only when Google credentials are absent. It walks the exact
 * same redirect → callback → session path as the real provider so the rest of
 * the app is exercised unchanged. The resulting account is clearly labelled.
 */
export class SandboxAuthProvider implements AuthProvider {
  readonly mode = 'sandbox' as const;
  readonly #appUrl: string;

  constructor(appUrl: string) {
    this.#appUrl = appUrl;
  }

  async createAuthorization(): Promise<AuthorizationRequest> {
    const state = randomBytes(24).toString('base64url');
    const url = new URL('/api/auth/google/callback', this.#appUrl);
    url.searchParams.set('state', state);
    url.searchParams.set('code', 'sandbox');
    return { url: url.toString(), state, codeVerifier: 'sandbox' };
  }

  async exchange({ code, state }: AuthCallbackParams): Promise<AuthProfile> {
    if (code !== 'sandbox') throw new Error('Unexpected sandbox authorization code.');
    // Each sandbox sign-in is a brand-new demo user so the onboarding can be replayed freely.
    const suffix = state.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
    return {
      provider: 'google',
      subject: `sandbox-${suffix}`,
      email: `owner+${suffix}@sandbox.current.surf`,
      emailVerified: true,
      name: 'Jordan Rivera',
      givenName: 'Jordan',
      familyName: 'Rivera',
      picture: null,
    };
  }
}
