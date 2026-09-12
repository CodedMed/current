import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SessionResponse } from '../../../shared/types.ts';
import { ApiError, UNAUTHENTICATED_EVENT, api } from './api.ts';

interface SessionContextValue {
  session: SessionResponse | null;
  loading: boolean;
  error: ApiError | null;
  /** Re-fetches the session from the server. */
  refresh: () => Promise<SessionResponse | null>;
  /** Applies a session returned by another endpoint without a round-trip. */
  apply: (next: SessionResponse) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const inFlight = useRef<Promise<SessionResponse | null> | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const p = (async () => {
      try {
        const next = await api.session();
        setSession(next);
        setError(null);
        return next;
      } catch (err) {
        setError(err instanceof ApiError ? err : new ApiError(0, 'network', 'Could not load your session.'));
        return null;
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = p;
    return p;
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthenticated = () => void refresh();
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
  }, [refresh]);

  const apply = useCallback((next: SessionResponse) => setSession(next), []);

  const signOut = useCallback(async () => {
    const next = await api.logout();
    setSession(next);
  }, []);

  const value = useMemo(() => ({ session, loading, error, refresh, apply, signOut }), [session, loading, error, refresh, apply, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
