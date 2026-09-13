import { LogOut } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { PublicUser } from '../../../../shared/types.ts';
import { initials } from '../../lib/format.ts';
import { LanguageSwitcher } from '../ui/LanguageSwitcher.tsx';
import { Logo } from '../ui/Logo.tsx';
import { WorkspaceNav } from './WorkspaceNav.tsx';

interface WorkspaceHeaderProps {
  user: PublicUser | null;
  /** Beside the wordmark: where these figures come from, how fresh they are, which adapter answers. */
  status?: ReactNode;
  /** This page's own controls, left of the account button. */
  actions?: ReactNode;
  /** A third row under the workspace nav: section tabs, a mode switch. */
  toolbar?: ReactNode;
  onSignOut: () => void;
}

/**
 * The chrome every signed-in page wears.
 *
 * It exists so the workspace nav lands on the same pixel on every page: when each surface built
 * its own header, moving between them shifted the tabs, and the app read as several apps stitched
 * together. Pages differ only in what they put in `status`, `actions` and `toolbar`.
 */
export function WorkspaceHeader({ user, status, actions, toolbar, onSignOut }: WorkspaceHeaderProps) {
  const ref = useRef<HTMLElement>(null);

  // Publish the real height so pages can sit under a sticky header without guessing at it.
  // Pages that hardcoded the number drifted out of step the moment a row was added or wrapped.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const publish = () => document.documentElement.style.setProperty('--workspace-header', `${element.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <header ref={ref} className="sticky top-0 z-30 border-b border-line bg-panel/95 backdrop-blur supports-[backdrop-filter]:bg-panel/85">
      <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-5 py-2.5 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Logo />
          {status}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <LanguageSwitcher />
          {actions}
          {user && (
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex h-9 items-center gap-2 rounded-lg pr-2 pl-1 text-sm font-medium text-ink-secondary transition-colors hover:bg-ink/5 hover:text-ink"
              title={`Sign out ${user.email}`}
            >
              {user.picture ? (
                <img src={user.picture} alt="" className="size-7 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <span className="grid size-7 place-items-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-800">{initials(user.name)}</span>
              )}
              <LogOut className="size-4" aria-hidden="true" />
              <span className="sr-only">Sign out</span>
            </button>
          )}
        </div>
      </div>

      <WorkspaceNav />
      {toolbar}
    </header>
  );
}
