import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    oauth?: {
      state: string;
      codeVerifier: string;
      createdAt: number;
    };
  }
}
