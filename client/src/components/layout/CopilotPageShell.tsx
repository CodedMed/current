import { LogOut } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useSession } from '../../lib/session.tsx';
import { Alert } from '../ui/Alert.tsx';
import { Button } from '../ui/Button.tsx';
import { Logo } from '../ui/Logo.tsx';
import { WorkspaceNav } from './WorkspaceNav.tsx';

export function CopilotPageShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const { signOut } = useSession();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logout = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate('/', { replace: true });
    } catch {
      setError('Could not sign out. Please try again.');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="min-h-dvh bg-surface">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-5 py-3 sm:px-8">
          <Logo />
          <WorkspaceNav className="order-3 w-full sm:order-none sm:w-auto" />
          <Button className="ml-auto" variant="ghost" size="sm" onClick={() => void logout()} loading={signingOut} icon={<LogOut className="size-4" aria-hidden="true" />}>Sign out</Button>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] space-y-6 px-5 py-6 sm:px-8 sm:py-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
          <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{description}</p>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        {children}
      </main>
    </div>
  );
}
