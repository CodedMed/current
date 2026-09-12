import { Keyboard, Mic, MicOff, PhoneOff, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn.ts';
import type { AdvisorStrings } from '../../lib/advisor/strings.ts';
import { isVoiceActive, type VoiceSnapshot } from '../../lib/advisor/voiceState.ts';
import { Alert } from '../ui/Alert.tsx';
import { Button } from '../ui/Button.tsx';
import { VoiceOrb } from './VoiceOrb.tsx';

interface VoicePanelProps {
  snapshot: VoiceSnapshot;
  strings: AdvisorStrings;
  reducedMotion: boolean;
  onStart: () => void;
  onStop: () => void;
  onSwitchToText: () => void;
  onMute: (muted: boolean) => void;
  inputVolume: () => number;
  outputVolume: () => number;
  className?: string;
}

/** The voice surface: the orb, the current state in words, and the controls that fit that state. */
export function VoicePanel({ snapshot, strings, reducedMotion, onStart, onStop, onSwitchToText, onMute, inputVolume, outputVolume, className }: VoicePanelProps) {
  const { state, message } = snapshot;
  const copy = strings.voiceStates[state];
  const orbRef = useRef<HTMLDivElement | null>(null);
  const [muted, setMuted] = useState(false);
  const active = isVoiceActive(state);

  // Feed the live volume into the orb while audio is flowing. This is a visualiser of real
  // signal, not a timer: it stops the moment the state leaves listening/speaking.
  useEffect(() => {
    if (reducedMotion || (state !== 'listening' && state !== 'speaking')) {
      orbRef.current?.style.setProperty('--level', '0');
      return;
    }
    let frame = 0;
    let smoothed = 0;
    const tick = () => {
      const raw = state === 'speaking' ? outputVolume() : muted ? 0 : inputVolume();
      const level = Math.min(1, Math.max(0, raw));
      smoothed = smoothed + (level - smoothed) * 0.35;
      orbRef.current?.style.setProperty('--level', smoothed.toFixed(3));
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [state, reducedMotion, inputVolume, outputVolume, muted]);

  useEffect(() => {
    if (!active) setMuted(false);
  }, [active]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    onMute(next);
  };

  return (
    <section aria-label={strings.voiceMode} className={cn('rounded-2xl bg-panel p-5 shadow-card ring-1 ring-ink/5 sm:p-6', className)}>
      <div className="flex flex-col items-center text-center">
        <VoiceOrb state={state} label={copy.label} levelRef={orbRef} reducedMotion={reducedMotion} />
        <p className="mt-2 text-base font-semibold text-ink" aria-live="polite">
          {copy.label}
        </p>
        <p className="mt-1 max-w-xs text-sm text-ink-secondary">{copy.hint}</p>

        {(state === 'error' || state === 'unavailable') && message && (
          <Alert tone={state === 'error' ? 'danger' : 'warning'} title={state === 'unavailable' ? strings.voiceUnavailableTitle : undefined} className="mt-4 w-full text-left">
            {message}
          </Alert>
        )}

        <div className="mt-5 flex w-full flex-col items-stretch gap-2 sm:flex-row sm:justify-center">
          {state === 'idle' && (
            <Button onClick={onStart} icon={<Mic className="size-4" aria-hidden="true" />}>
              {strings.startVoice}
            </Button>
          )}
          {state === 'connecting' && (
            <Button loading disabled>
              {strings.connecting}
            </Button>
          )}
          {(state === 'listening' || state === 'thinking' || state === 'speaking') && (
            <>
              <Button variant="secondary" onClick={toggleMute} icon={muted ? <MicOff className="size-4" aria-hidden="true" /> : <Mic className="size-4" aria-hidden="true" />} aria-pressed={muted}>
                {muted ? strings.micUnmute : strings.micMute}
              </Button>
              <Button variant="danger" onClick={onStop} icon={<PhoneOff className="size-4" aria-hidden="true" />}>
                {strings.endVoice}
              </Button>
            </>
          )}
          {state === 'error' && (
            <>
              <Button onClick={onStart} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
                {strings.tryAgain}
              </Button>
              <Button variant="secondary" onClick={onSwitchToText} icon={<Keyboard className="size-4" aria-hidden="true" />}>
                {strings.switchToText}
              </Button>
            </>
          )}
          {state === 'unavailable' && (
            <>
              <Button variant="secondary" onClick={onStart} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
                {strings.tryAgain}
              </Button>
              <Button onClick={onSwitchToText} icon={<Keyboard className="size-4" aria-hidden="true" />}>
                {strings.switchToText}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="mt-5 space-y-2 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        <p>{strings.voiceHow}</p>
        <p className="flex gap-2">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-positive-600" aria-hidden="true" />
          <span>{strings.voicePrivacy}</span>
        </p>
      </div>
    </section>
  );
}
