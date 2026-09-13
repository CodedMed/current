import { AudioLines } from 'lucide-react';
import type { CopilotHealth } from '../../../../shared/copilot.ts';
import type { PublicUser } from '../../../../shared/types.ts';
import type { AdvisorStrings } from '../../lib/advisor/strings.ts';
import { WorkspaceHeader } from '../layout/WorkspaceHeader.tsx';
import { Badge } from '../ui/Badge.tsx';
import { Segmented } from '../cashflow/Segmented.tsx';

export type AdvisorMode = 'text' | 'voice';

interface AdvisorHeaderProps {
  user: PublicUser | null;
  strings: AdvisorStrings;
  mode: AdvisorMode;
  health: CopilotHealth | null;
  onMode: (mode: AdvisorMode) => void;
  onSignOut: () => void;
}

/** The workspace header as the advisor wears it: which engine answers, and how you talk to it. */
export function AdvisorHeader({ user, strings, mode, health, onMode, onSignOut }: AdvisorHeaderProps) {
  const advisor = health?.intelligence.adapters?.advisor ?? null;
  const voice = health?.intelligence.adapters?.voice ?? null;

  const status = (
    <>
      {advisor && (
        <Badge
          tone={advisor === 'gemini' ? 'success' : 'warning'}
          className="hidden shrink-0 sm:inline-flex"
          title={advisor === 'gemini' ? 'Answers come from Gemini over your ledger context' : strings.demoAdvisorTitle}
        >
          {advisor === 'gemini' ? strings.gemini : strings.demoAdvisor}
        </Badge>
      )}
      {voice && (
        <Badge
          tone={voice === 'elevenlabs' ? 'success' : 'neutral'}
          className="hidden shrink-0 lg:inline-flex"
          title={voice === 'elevenlabs' ? 'Voice conversations are available' : 'Voice is unavailable. You can still ask questions in text.'}
        >
          <AudioLines className="size-3" aria-hidden="true" />
          {voice === 'elevenlabs' ? 'Voice' : 'Voice off'}
        </Badge>
      )}
    </>
  );

  // Sits where the dashboard's section tabs sit, so the row below the nav means the same thing
  // on both pages: what this page is currently showing.
  const toolbar = (
    <div className="mx-auto flex max-w-[1400px] items-center px-5 pb-2 sm:px-8">
      <Segmented
        label="Mode"
        value={mode}
        onChange={onMode}
        options={[
          { id: 'text', label: strings.textMode, title: 'Ask by typing' },
          { id: 'voice', label: strings.voiceMode, title: 'Talk to the advisor' },
        ]}
      />
    </div>
  );

  return <WorkspaceHeader user={user} status={status} toolbar={toolbar} onSignOut={onSignOut} />;
}
