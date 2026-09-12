import { randomBytes } from 'node:crypto';
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import type { GoogleConfig } from '../../config.ts';
import { IntegrationError, badRequest } from '../../lib/errors.ts';
import type { AuthProfile } from '../../store/userStore.ts';
import type { AuthCallbackParams, AuthProvider, AuthorizationRequest } from './types.ts';

/**
 * Google sign-in via OAuth 2.0 authorization code flow with PKCE. The client
 * secret and token exchange live entirely on the server; the browser only ever
 * sees the redirect.
 */
export class GoogleAuthProvider implements AuthProvider {
  readonly mode = 'live' as const;
  readonly #client: OAuth2Client;
  readonly #clientId: string;

  constructor(config: GoogleConfig) {
    this.#clientId = config.clientId;
    this.#client = new OAuth2Client({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    });
  }

  async createAuthorization(): Promise<AuthorizationRequest> {
    const { codeVerifier, codeChallenge } = await this.#client.generateCodeVerifierAsync();
    const state = randomBytes(24).toString('base64url');
    const url = this.#client.generateAuthUrl({
      access_type: 'online',
      scope: ['openid', 'email', 'profile'],
      state,
      prompt: 'select_account',
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
    return { url, state, codeVerifier };
  }

  async exchange({ code, codeVerifier }: AuthCallbackParams): Promise<AuthProfile> {
    let idToken: string | null | undefined;
    try {
      const { tokens } = await this.#client.getToken({ code, codeVerifier });
      idToken = tokens.id_token;
    } catch (err) {
      throw new IntegrationError('google', 'Google did not accept the sign-in code.', null, describe(err));
    }
    if (!idToken) throw new IntegrationError('google', 'Google did not return an identity token.');

    const ticket = await this.#client.verifyIdToken({ idToken, audience: this.#clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) throw badRequest('Google account is missing an email address.');
    if (payload.email_verified === false) throw badRequest('Your Google email address is not verified.');

    const givenName = payload.given_name ?? payload.name?.split(' ')[0] ?? payload.email.split('@')[0] ?? 'there';
    return {
      provider: 'google',
      subject: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified ?? true,
      name: payload.name ?? `${givenName} ${payload.family_name ?? ''}`.trim(),
      givenName,
      familyName: payload.family_name ?? '',
      picture: payload.picture ?? null,
    };
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
