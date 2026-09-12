import type { UserRecord } from '../store/userStore.ts';

declare global {
  namespace Express {
    interface Locals {
      user?: UserRecord;
    }
  }
}

export {};
