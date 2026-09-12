import { Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { AdvisorLanguage, AdvisorReply, CopilotHealth } from '../../../shared/copilot.ts';
import type { AdvisorMode } from '../components/advisor/AdvisorHeader.tsx';
import { AdvisorHeader } from '../components/advisor/AdvisorHeader.tsx';
import { Composer } from '../components/advisor/Composer.tsx';
import { AdvisorBubble, UserBubble } from '../components/advisor/MessageBubble.tsx';
import type { RecommendationStatus } from '../components/advisor/RecommendationCard.tsx';
import { SnapshotPanel } from '../components/advisor/SnapshotPanel.tsx';
import { VoicePanel } from '../components/advisor/VoicePanel.tsx';
import { useReducedMotion } from '../hooks/useReducedMotion.ts';
import { useVoiceAdvisor } from '../hooks/useVoiceAdvisor.ts';
import { ApiError, api } from '../lib/api.ts';
import { SUGGESTED_QUESTIONS, actionKey, newMessageId, toHistory, todoFromAction, type AdvisorMessage, type ConversationMessage } from '../lib/advisor/conversation.ts';
import { STRINGS } from '../lib/advisor/strings.ts';
import { isVoiceActive } from '../lib/advisor/voiceState.ts';
import { cn } from '../lib/cn.ts';
import { useSession } from '../lib/session.tsx';

const LANGUAGE_KEY = 'keel.advisor.language';

function initialLanguage(): AdvisorLanguage {
  try {
    const saved = window.localStorage.getItem(LANGUAGE_KEY);
    if (saved === 'en' || saved === 'es') return saved;
  } catch {
    // Storage may be unavailable; English is the default either way.
  }
  return 'en';
}

/**
 * The financial advisor. One conversation thread serves both surfaces: typed questions go
 * straight to the BFF, spoken questions arrive through the ElevenLabs client tool, and both run
 * the same ledger → intelligence → Gemini pipeline. Recommendations are proposals until the owner
 * adds them to tasks here.
 */
export default function AdvisorPage() {
  const { session, signOut } = useSession();
  const navigate = useNavigate();
  const user = session?.user ?? null;
  const reducedMotion = useReducedMotion();

  const [mode, setMode] = useState<AdvisorMode>('text');
  const [language, setLanguage] = useState<AdvisorLanguage>(initialLanguage);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, RecommendationStatus | undefined>>({});
  const [health, setHealth] = useState<CopilotHealth | null>(null);
  const [snapshotVersion, setSnapshotVersion] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const messagesRef = useRef<ConversationMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const strings = STRINGS[language];

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      // ignore
    }
  }, [language]);

  useEffect(() => {
    let cancelled = false;
    api.copilot
      .health()
      .then((next) => {
        if (!cancelled) setHealth(next);
      })
      .catch(() => {
        if (!cancelled) setHealth(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3800);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Keep the newest turn in view as the thread grows.
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'end' });
  }, [lastMessage, reducedMotion]);

  const append = useCallback((message: ConversationMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const patchAdvisor = useCallback((id: string, patch: Partial<AdvisorMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id && m.role === 'advisor' ? { ...m, ...patch } : m)));
  }, []);

  /* ── text turns ── */

  const ask = useCallback(
    async (question: string, replaceId?: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const history = toHistory(messagesRef.current.filter((m) => m.id !== replaceId));
      const advisorId = replaceId ?? newMessageId();
      if (replaceId) {
        patchAdvisor(replaceId, { reply: null, error: null, spoken: null, createdAt: Date.now() });
      } else {
        append({ id: newMessageId(), role: 'user', content: trimmed, createdAt: Date.now(), channel: 'text' });
        append({ id: advisorId, role: 'advisor', createdAt: Date.now(), channel: 'text', question: trimmed, reply: null, spoken: null, error: null });
      }
      setPendingId(advisorId);
      try {
        const reply = await api.copilot.ask(trimmed, language, history, controller.signal);
        if (controller.signal.aborted) return;
        patchAdvisor(advisorId, { reply, error: null });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof ApiError ? err.message : language === 'es' ? 'No se pudo obtener una respuesta.' : 'Could not get an answer.';
        const retryable = err instanceof ApiError ? err.retryable : true;
        patchAdvisor(advisorId, { error: { message, retryable } });
      } finally {
        if (abortRef.current === controller) setPendingId(null);
      }
    },
    [append, language, patchAdvisor],
  );

  /* ── voice turns: same thread, same pipeline ── */

  const voice = useVoiceAdvisor(language, {
    onUserTranscript: (text) => append({ id: newMessageId(), role: 'user', content: text, createdAt: Date.now(), channel: 'voice' }),
    onAdvisorReply: (question, reply: AdvisorReply) =>
      append({ id: newMessageId(), role: 'advisor', createdAt: Date.now(), channel: 'voice', question, reply, spoken: null, error: null }),
    onAdvisorError: (question, message, retryable) =>
      append({ id: newMessageId(), role: 'advisor', createdAt: Date.now(), channel: 'voice', question, reply: null, spoken: null, error: { message, retryable } }),
    onAgentMessage: (text) => append({ id: newMessageId(), role: 'advisor', createdAt: Date.now(), channel: 'voice', question: '', reply: null, spoken: text, error: null }),
    history: () => toHistory(messagesRef.current),
  });
  const voiceActive = isVoiceActive(voice.snapshot.state);

  const changeMode = (next: AdvisorMode) => {
    if (next === mode) return;
    if (next === 'text' && (voiceActive || voice.snapshot.state === 'error' || voice.snapshot.state === 'unavailable')) void voice.stop();
    setMode(next);
  };

  const changeLanguage = (next: AdvisorLanguage) => {
    if (next === language) return;
    if (voiceActive) {
      void voice.stop();
      setToast(STRINGS[next].voiceStoppedForLanguage);
    }
    setLanguage(next);
  };

  const send = (text: string) => {
    if (mode === 'voice' && voiceActive && voice.sendText(text)) {
      append({ id: newMessageId(), role: 'user', content: text, createdAt: Date.now(), channel: 'voice' });
      return;
    }
    void ask(text);
  };

  /* ── recommendations → tasks, only on an explicit click ── */

  const addTask = async (message: AdvisorMessage, index: number) => {
    const action = message.reply?.proposedActions[index];
    if (!action) return;
    const key = actionKey(message.id, index);
    setStatuses((prev) => ({ ...prev, [key]: 'adding' }));
    try {
      await api.copilot.todos.create(todoFromAction(action, { question: message.question, language, channel: message.channel }));
      setStatuses((prev) => ({ ...prev, [key]: 'added' }));
      setSnapshotVersion((v) => v + 1);
      setToast(strings.taskAdded);
    } catch (err) {
      setStatuses((prev) => ({ ...prev, [key]: 'open' }));
      setToast(err instanceof ApiError ? err.message : strings.taskFailed);
    }
  };

  const handleSignOut = async () => {
    await voice.stop();
    await signOut();
    navigate('/', { replace: true });
  };

  const suggestions = useMemo(() => SUGGESTED_QUESTIONS[language], [language]);
  const placeholder = mode === 'voice' && voiceActive ? strings.voicePlaceholder : strings.placeholder;

  return (
    <div className="min-h-dvh bg-surface">
      <AdvisorHeader user={user} strings={strings} mode={mode} language={language} health={health} onMode={changeMode} onLanguage={changeLanguage} onSignOut={() => void handleSignOut()} />

      <main className="mx-auto grid max-w-[1400px] gap-5 px-5 py-5 sm:px-8 sm:py-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <section aria-label={strings.title} className="flex min-h-[calc(100dvh-8.5rem)] flex-col overflow-hidden rounded-2xl bg-panel shadow-card ring-1 ring-ink/5 lg:sticky lg:top-[4.25rem] lg:max-h-[calc(100dvh-5.5rem)]">
          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6" role="log" aria-live="polite" aria-relevant="additions">
            {messages.length === 0 ? (
              <EmptyState strings={strings} suggestions={suggestions} onPick={(q) => send(q)} />
            ) : (
              messages.map((message) =>
                message.role === 'user' ? (
                  <UserBubble key={message.id} message={message} strings={strings} />
                ) : (
                  <AdvisorBubble
                    key={message.id}
                    message={message}
                    strings={strings}
                    language={language}
                    statuses={statuses}
                    onAddTask={(m, i) => void addTask(m, i)}
                    onDismiss={(key) => setStatuses((prev) => ({ ...prev, [key]: 'dismissed' }))}
                    onUndo={(key) => setStatuses((prev) => ({ ...prev, [key]: 'open' }))}
                    onRetry={(m) => void ask(m.question, m.id)}
                  />
                ),
              )
            )}
            <div ref={endRef} />
          </div>
          {messages.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-t border-line px-4 pt-3 sm:px-6">
              {suggestions.slice(0, 3).map((q) => (
                <button key={q} type="button" onClick={() => send(q)} disabled={pendingId !== null} className="rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink-secondary ring-1 ring-inset ring-line transition-colors hover:bg-brand-50 hover:text-brand-800 disabled:opacity-50">
                  {q}
                </button>
              ))}
            </div>
          )}
          <Composer strings={strings} placeholder={placeholder} pending={pendingId !== null} onSend={send} />
        </section>

        <aside className="space-y-5">
          {mode === 'voice' && (
            <VoicePanel
              className="order-first lg:order-none"
              snapshot={voice.snapshot}
              strings={strings}
              reducedMotion={reducedMotion}
              onStart={() => void voice.start()}
              onStop={() => void voice.stop()}
              onSwitchToText={() => changeMode('text')}
              onMute={voice.setMicMuted}
              inputVolume={voice.inputVolume}
              outputVolume={voice.outputVolume}
            />
          )}
          <SnapshotPanel strings={strings} version={snapshotVersion} />
          <section className="rounded-2xl bg-panel p-5 text-sm shadow-card ring-1 ring-ink/5 sm:p-6" aria-label={strings.privacyTitle}>
            <h2 className="text-[15px] font-semibold text-ink">{strings.privacyTitle}</h2>
            <p className="mt-2 leading-relaxed text-ink-secondary">{strings.privacyBody}</p>
          </section>
        </aside>
      </main>

      {toast && (
        <div role="status" className={cn('fixed bottom-5 left-1/2 z-[60] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full bg-navy-900 px-4 py-2 text-sm font-medium text-white shadow-float', !reducedMotion && 'animate-fade-up')}>
          {toast}
        </div>
      )}
    </div>
  );
}

function EmptyState({ strings, suggestions, onPick }: { strings: (typeof STRINGS)['en']; suggestions: readonly string[]; onPick: (question: string) => void }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-8 text-center sm:py-14">
      <span className="grid size-14 place-items-center rounded-2xl bg-navy-900 text-brand-200 shadow-card">
        <Sparkles className="size-7" aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-xl font-bold tracking-tight text-ink sm:text-2xl">{strings.emptyTitle}</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{strings.emptyBody}</p>
      <p className="mt-6 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">{strings.suggestions}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {suggestions.map((q) => (
          <button key={q} type="button" onClick={() => onPick(q)} className="rounded-full bg-surface px-3.5 py-1.5 text-sm font-medium text-ink ring-1 ring-inset ring-line transition-colors hover:bg-brand-50 hover:text-brand-800 hover:ring-brand-200">
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
