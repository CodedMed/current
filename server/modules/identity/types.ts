import type {
  IdentitySessionResponse,
  IdentityStatus,
  IntegrationMode,
  SandboxIdentityOutcome,
} from '../../../shared/types.ts';
import type { UserRecord } from '../../store/userStore.ts';

export interface IdentityOutcome {
  status: IdentityStatus;
  inquiryId: string | null;
  detail: string | null;
}

export interface IdentityService {
  readonly mode: IntegrationMode;
  /** Creates or resumes an inquiry and returns what the client needs to open the flow. */
  startSession(user: UserRecord): Promise<Omit<IdentitySessionResponse, 'nextStep'>>;
  /** Called when the embedded flow reports completion; re-checks status with the provider. */
  complete(user: UserRecord, inquiryId: string): Promise<IdentityOutcome>;
  /** Re-reads the current status from the provider (used for pending decisions). */
  refresh(user: UserRecord): Promise<IdentityOutcome>;
  /** Sandbox only: sets an explicit outcome. */
  simulate?(user: UserRecord, outcome: SandboxIdentityOutcome): Promise<IdentityOutcome>;
  /** Live only: processes a signed webhook payload. Returns the affected inquiry id. */
  handleWebhook?(rawBody: Buffer, signatureHeader: string | undefined): Promise<string | null>;
}
