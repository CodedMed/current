import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useSession } from '../../lib/session.tsx';
import { Alert } from '../ui/Alert.tsx';
import { WorkspaceHeader } from './WorkspaceHeader.tsx';

/** Documents and tasks: the same chrome as the dashboard and the advisor, with a page heading. */
export function CopilotPageShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const { session, signOut } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const logout = async () => {
    try {
      await signOut();
      navigate('/', { replace: true });
    } catch {
      setError('Could not sign out. Please try again.');
    }
  };

  return (
    <div className="min-h-dvh bg-surface">
      <WorkspaceHeader user={session?.user ?? null} onSignOut={() => void logout()} />
      <main className="mx-auto max-w-[1400px] space-y-6 px-5 pt-6 pb-24 sm:px-8 sm:pt-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">{title}</h1>
          <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{description}</p>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        {children}
      </main>
    </div>
  );
}
