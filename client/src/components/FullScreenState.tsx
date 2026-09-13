import { RefreshCw } from 'lucide-react';
import { Button } from './ui/Button.tsx';
import { LogoMark } from './ui/Logo.tsx';
import { Spinner } from './ui/Spinner.tsx';

export function FullScreenLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-surface" role="status" aria-live="polite">
      <div className="animate-fade-in flex flex-col items-center gap-4">
        <LogoMark className="size-12 animate-pulse-soft" />
        <span className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner className="size-4" /> {label}
        </span>
      </div>
    </div>
  );
}

export function FullScreenError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-surface px-5">
      <div className="animate-fade-up w-full max-w-md rounded-2xl bg-panel p-8 text-center shadow-card ring-1 ring-ink/5">
        <LogoMark className="mx-auto size-12" />
        <h1 className="mt-5 text-xl font-bold text-ink">We couldn't reach current.surf</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{message}</p>
        <Button className="mt-6" onClick={onRetry} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
          Try again
        </Button>
      </div>
    </div>
  );
}
