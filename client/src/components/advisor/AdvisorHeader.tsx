import { AudioLines, LayoutDashboard, LogOut, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import type { AdvisorLanguage, CopilotHealth } from '../../../../shared/copilot.ts';
import type { PublicUser } from '../../../../shared/types.ts';
import { initials } from '../../lib/format.ts';
import type { AdvisorStrings } from '../../lib/advisor/strings.ts';
import { Segmented } from '../cashflow/Segmented.tsx';
import { Badge } from '../ui/Badge.tsx';
import { buttonClasses } from '../ui/Button.tsx';
import { Logo } from '../ui/Logo.tsx';
import { WorkspaceNav } from '../layout/WorkspaceNav.tsx';

export type AdvisorMode = 'text' | 'voice';

interface AdvisorHeaderProps {
  user: PublicUser | null;
  strings: AdvisorStrings;
  mode: AdvisorMode;
  language: AdvisorLanguage;
  health: CopilotHealth | null;
  onMode: (mode: AdvisorMode) => void;
  onLanguage: (language: AdvisorLanguage) => void;
  onSignOut: () => void;
}

export function AdvisorHeader({ user, strings, mode, language, health, onMode, onLanguage, onSignOut }: AdvisorHeaderProps) {
  const advisor = health?.intelligence.adapters?.advisor ?? null;
  const voice = health?.intelligence.adapters?.voice ?? null;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-panel/95 backdrop-blur supports-[backdrop-filter]:bg-panel/85">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Logo />
          <span className="hidden h-5 border-l border-line sm:block" aria-hidden="true" />
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Sparkles className="size-4 text-brand-600" aria-hidden="true" />
            {strings.title}
          </span>
          {advisor && (
            <Badge tone={advisor === 'gemini' ? 'success' : 'warning'} title={advisor === 'gemini' ? 'Answers come from Gemini over your ledger context' : strings.demoAdvisorTitle}>
              {advisor === 'gemini' ? strings.gemini : strings.demoAdvisor}
            </Badge>
          )}
          {voice && (
            <Badge tone={voice === 'elevenlabs' ? 'success' : 'neutral'} className="hidden md:inline-flex" title={voice === 'elevenlabs' ? 'Voice conversations are available' : 'Voice is unavailable. You can still ask questions in text.'}>
              <AudioLines className="size-3" aria-hidden="true" />
              {voice === 'elevenlabs' ? 'Voice' : 'Voice off'}
            </Badge>
          )}
        </div>

        <div className="order-3 flex w-full items-center gap-2 sm:order-none sm:ml-2 sm:w-auto sm:border-l sm:border-line sm:pl-4">
          <Segmented
            label="Mode"
            value={mode}
            onChange={onMode}
            options={[
              { id: 'text', label: strings.textMode, title: 'Ask by typing' },
              { id: 'voice', label: strings.voiceMode, title: 'Talk to the advisor' },
            ]}
          />
          <Segmented
            label={strings.language}
            value={language}
            onChange={onLanguage}
            options={[
              { id: 'en', label: 'English' },
              { id: 'es', label: 'Español' },
            ]}
          />
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <Link to="/dashboard" className={buttonClasses('secondary', 'sm')}>
            <LayoutDashboard className="size-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">{strings.dashboard}</span>
          </Link>
          {user && (
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex h-9 items-center gap-2 rounded-lg pr-2 pl-1 text-sm font-medium text-ink-secondary transition-colors hover:bg-ink/5 hover:text-ink"
              title={`${strings.signOut} ${user.email}`}
            >
              {user.picture ? (
                <img src={user.picture} alt="" className="size-7 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <span className="grid size-7 place-items-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-800">{initials(user.name)}</span>
              )}
              <LogOut className="size-4" aria-hidden="true" />
              <span className="sr-only">{strings.signOut}</span>
            </button>
          )}
        </div>
        <WorkspaceNav className="order-last w-full" />
      </div>
    </header>
  );
}
