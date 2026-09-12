import type { IntegrationMode } from '../../../shared/types.ts';
import type { AuthProfile } from '../../store/userStore.ts';

export interface AuthorizationRequest {
  /** Where to send the browser. */
  url: string;
  /** Anti-CSRF token echoed back by the provider. */
  state: string;
  /** PKCE verifier kept server-side until the callback. */
  codeVerifier: string;
}

export interface AuthCallbackParams {
  code: string;
  state: string;
  codeVerifier: string;
}

export interface AuthProvider {
  readonly mode: IntegrationMode;
  createAuthorization(): Promise<AuthorizationRequest>;
  exchange(params: AuthCallbackParams): Promise<AuthProfile>;
}
