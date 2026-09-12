import type { UserRecord } from '../store/userStore.ts';

declare global {
  namespace Express {
    interface Locals {
      user?: UserRecord;
      /** Stable subject forwarded to the copilot services, set by the copilot router. */
      copilotSubject?: string;
    }
  }
}

export {};
