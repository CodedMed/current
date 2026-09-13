import { AudioLines, Mic, MicOff, PhoneOff, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { AdvisorReply, AdvisorTurn } from '../../../../shared/copilot.ts';
import { useReducedMotion } from '../../hooks/useReducedMotion.ts';
import { useVoiceAdvisor } from '../../hooks/useVoiceAdvisor.ts';
import { isVoiceActive } from '../../lib/advisor/voiceState.ts';
import { stringsFor } from '../../lib/advisor/strings.ts';
import { cn } from '../../lib/cn.ts';
import { useLanguage } from '../../lib/i18n/LanguageProvider.tsx';
import { useSession } from '../../lib/session.tsx';
import { VoiceOrb } from './VoiceOrb.tsx';

/** Turns kept for continuity across a docked conversation. The facts are re-fetched every turn. */
const HISTORY_LIMIT = 8;

interface Turn {
  question: string;
  answer: string;
}

/**
 * Talk to the advisor from wherever you are.
 *
 * The advisor page owns its own voice session, so this never renders there — two sessions would
 * mean two microphones and two bills. Everywhere else in the workspace this is the whole voice
 * surface: one button, and a card that shows what was asked and what came back.
 */
export function VoiceDock() {
  const { session } = useSession();
  const { pathname } = useLocation();
  const { language } = useLanguage();
  const reducedMotion = useReducedMotion();
  const strings = stringsFor(language);

  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnsRef = useRef<Turn[]>([]);
  const orbRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  const history = useCallback((): AdvisorTurn[] => {
    const flat: AdvisorTurn[] = [];
    for (const turn of turnsRef.current.slice(-HISTORY_LIMIT)) {
      flat.push({ role: 'user', content: turn.question });
      flat.push({ role: 'advisor', content: turn.answer });
    }
    return flat;
  }, []);

  const voice = useVoiceAdvisor(language, {
    onUserTranscript: (text) => setTurns((prev) => [...prev, { question: text, answer: '' }]),
    onAdvisorReply: (question: string, reply: AdvisorReply) =>
      setTurns((prev) => replaceAnswer(prev, question, reply.summary || reply.answer)),
    onAdvisorError: (question: string, message: string) => setTurns((prev) => replaceAnswer(prev, question, message)),
    onAgentMessage: (text) => setTurns((prev) => replaceAnswer(prev, '', text)),
    history,
  });

  const state = voice.snapshot.state;
  const active = isVoiceActive(state);
  const copy = strings.voiceStates[state];

  // The orb visualises real audio level, so it runs only while audio is actually flowing.
  useEffect(() => {
    if (reducedMotion || (state !== 'listening' && state !== 'speaking')) {
      orbRef.current?.style.setProperty('--level', '0');
      return;
    }
    let frame = 0;
    let smoothed = 0;
    const tick = () => {
      const raw = state === 'speaking' ? voice.outputVolume() : muted ? 0 : voice.inputVolume();
      smoothed += (Math.min(1, Math.max(0, raw)) - smoothed) * 0.35;
      orbRef.current?.style.setProperty('--level', smoothed.toFixed(3));
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [state, reducedMotion, muted, voice]);

  // Leaving the workspace must not leave a microphone open.
  const onAdvisorPage = pathname.startsWith('/advisor');
  useEffect(() => {
    if (onAdvisorPage && active) void voice.stop();
  }, [onAdvisorPage, active, voice]);

  if (!session?.user || session.nextStep !== 'dashboard' || onAdvisorPage) return null;

  const start = () => {
    setOpen(true);
    setTurns([]);
    void voice.start();
  };

  const close = () => {
    void voice.stop();
    setOpen(false);
    setMuted(false);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    voice.setMicMuted(next);
  };

  const latest = turns.at(-1);

  return (
    <div className="fixed right-4 bottom-4 z-40 flex flex-col items-end gap-2 sm:right-6 sm:bottom-6">
      {open && (
        <section
          aria-label={strings.voiceMode}
          className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl bg-panel p-4 shadow-lg ring-1 ring-ink/10"
        >
          <div className="flex items-start gap-3">
            <VoiceOrb state={state} label={copy.label} levelRef={orbRef} reducedMotion={reducedMotion} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink" aria-live="polite">
                {copy.label}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">{voice.snapshot.message ?? copy.hint}</p>
            </div>
            <button
              type="button"
              onClick={close}
              title={strings.endVoice}
              className="rounded-lg p-1 text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink"
            >
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">{strings.endVoice}</span>
            </button>
          </div>

          {latest && (latest.question || latest.answer) && (
            <div className="mt-3 space-y-2 border-t border-line pt-3">
              {latest.question && <p className="text-xs text-ink-muted">“{latest.question}”</p>}
              {latest.answer && <p className="text-sm leading-relaxed text-ink">{latest.answer}</p>}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            {active && (
              <button
                type="button"
                onClick={toggleMute}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-ink-secondary ring-1 ring-inset ring-line transition-colors hover:bg-ink/5"
              >
                {muted ? <MicOff className="size-3.5" aria-hidden="true" /> : <Mic className="size-3.5" aria-hidden="true" />}
                {muted ? strings.micUnmute : strings.micMute}
              </button>
            )}
            {(state === 'idle' || state === 'error' || state === 'unavailable') && (
              <button
                type="button"
                onClick={() => void voice.start()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700"
              >
                <Mic className="size-3.5" aria-hidden="true" />
                {strings.startVoice}
              </button>
            )}
            <Link
              to="/advisor"
              onClick={close}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50"
            >
              <Sparkles className="size-3.5" aria-hidden="true" />
              {strings.title}
            </Link>
            {active && (
              <button
                type="button"
                onClick={close}
                title={strings.endVoice}
                className="inline-flex size-8 items-center justify-center rounded-lg text-danger-700 transition-colors hover:bg-danger-50"
              >
                <PhoneOff className="size-3.5" aria-hidden="true" />
                <span className="sr-only">{strings.endVoice}</span>
              </button>
            )}
          </div>
        </section>
      )}

      {!open && (
        <button
          type="button"
          onClick={start}
          title={strings.startVoice}
          className={cn(
            'inline-flex h-13 items-center gap-2 rounded-full bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:bg-brand-700',
            !reducedMotion && 'hover:scale-105',
          )}
        >
          <AudioLines className="size-5" aria-hidden="true" />
          <span className="hidden sm:inline">{strings.voiceMode}</span>
        </button>
      )}
    </div>
  );
}

/** Fills in the answer for the newest turn, or adds one when the agent spoke unprompted. */
function replaceAnswer(turns: Turn[], question: string, answer: string): Turn[] {
  const last = turns.at(-1);
  if (last && last.answer === '' && (question === '' || last.question === question)) {
    return [...turns.slice(0, -1), { question: last.question, answer }];
  }
  return [...turns, { question, answer }];
}
