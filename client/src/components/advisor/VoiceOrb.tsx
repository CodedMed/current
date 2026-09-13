import { CircleAlert, Mic, MicOff } from 'lucide-react';
import type { RefObject } from 'react';
import { cn } from '../../lib/cn.ts';
import type { VoiceState } from '../../lib/advisor/voiceState.ts';

interface VoiceOrbProps {
  state: VoiceState;
  label: string;
  /** Receives `--level` (0–1) from the live microphone / playback volume; drives the bars and the core scale. */
  levelRef?: RefObject<HTMLDivElement | null>;
  reducedMotion?: boolean;
  /** `sm` is the docked orb that sits beside text; `lg` is the advisor page's centrepiece. */
  size?: 'sm' | 'lg';
  className?: string;
}

const SIZES = {
  sm: { root: 'size-16', core: 'size-11', ring: 'inset-1', icon: 'size-5' },
  lg: { root: 'size-44', core: 'size-28', ring: 'inset-3', icon: 'size-9' },
} as const;

const CORE: Record<VoiceState, string> = {
  idle: 'bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-[0_18px_40px_-18px_rgb(59_111_240/0.7)]',
  connecting: 'bg-gradient-to-br from-brand-300 to-brand-500 text-white shadow-[0_18px_40px_-18px_rgb(59_111_240/0.6)]',
  listening: 'bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-[0_18px_44px_-16px_rgb(37_84_227/0.8)]',
  thinking: 'bg-gradient-to-br from-navy-700 to-navy-900 text-brand-200 shadow-[0_18px_40px_-18px_rgb(11_18_32/0.7)]',
  speaking: 'bg-gradient-to-br from-brand-600 to-navy-800 text-white shadow-[0_18px_44px_-16px_rgb(37_84_227/0.85)]',
  error: 'bg-danger-50 text-danger-600 ring-2 ring-danger-200',
  unavailable: 'bg-surface text-ink-muted ring-1 ring-line-strong',
};

const RING: Record<VoiceState, string> = {
  idle: 'border-brand-200',
  connecting: 'border-brand-200',
  listening: 'border-brand-300',
  thinking: 'border-navy-600/30',
  speaking: 'border-brand-400',
  error: 'border-danger-200',
  unavailable: 'border-line',
};

/**
 * The advisor's voice presence: one calm orb whose shape follows the real conversation state.
 * Rings expand while listening and speaking, a dashed halo turns while thinking, and the core
 * breathes when idle. Motion is driven by CSS keyframes (paused by the global reduced-motion
 * rule) plus a `--level` variable fed from the SDK's live volume, never by timers guessing state.
 */
export function VoiceOrb({ state, label, levelRef, reducedMotion = false, size = 'lg', className }: VoiceOrbProps) {
  const animated = !reducedMotion;
  const scale = SIZES[size];
  const rings = animated && (state === 'listening' || state === 'speaking') ? [0, 1, 2] : [];
  return (
    <div ref={levelRef} data-state={state} role="img" aria-label={label} className={cn('relative grid place-items-center', scale.root, className)} style={{ ['--level' as string]: 0 }}>
      {rings.map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn('absolute rounded-full border-2 animate-orb-ring', scale.ring, RING[state])}
          style={{ animationDelay: `${i * 0.85}s`, animationDuration: state === 'speaking' ? '2.1s' : '2.8s' }}
        />
      ))}
      {!animated && (state === 'listening' || state === 'speaking') && (
        <span aria-hidden="true" className={cn('absolute inset-1 rounded-full border-2 border-dashed', RING[state])} />
      )}
      {state === 'thinking' && (
        <svg aria-hidden="true" viewBox="0 0 100 100" className={cn('absolute inset-0 size-full text-brand-400', animated && 'animate-orb-think')}>
          <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="18 12" opacity="0.9" />
        </svg>
      )}
      {state === 'connecting' && (
        <svg aria-hidden="true" viewBox="0 0 100 100" className={cn('absolute inset-0 size-full text-brand-300', animated && 'animate-spin')}>
          <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="60 230" />
        </svg>
      )}
      <div
        aria-hidden="true"
        className={cn(
          'relative grid place-items-center rounded-full transition-[background-color,box-shadow,color] duration-500',
          scale.core,
          CORE[state],
          animated && state === 'idle' && 'animate-orb-breathe',
        )}
        style={{ transform: state === 'speaking' || state === 'listening' ? 'scale(calc(1 + var(--level, 0) * 0.14))' : undefined, transitionProperty: 'background-color, box-shadow, color, transform' }}
      >
        {state === 'listening' || state === 'speaking' ? (
          <Bars animated={animated} tone={state} />
        ) : state === 'thinking' ? (
          <Dots animated={animated} />
        ) : state === 'error' ? (
          <CircleAlert className={scale.icon} />
        ) : state === 'unavailable' ? (
          <MicOff className={scale.icon} />
        ) : (
          <Mic className={scale.icon} />
        )}
      </div>
    </div>
  );
}

/** Five sound-wave bars. Listening bars rise with the microphone level; speaking bars with playback. */
function Bars({ animated, tone }: { animated: boolean; tone: 'listening' | 'speaking' }) {
  const heights = [0.45, 0.75, 1, 0.75, 0.45];
  return (
    <div className="flex h-10 items-center gap-1.5" aria-hidden="true">
      {heights.map((h, i) => (
        <span
          key={i}
          className={cn('block w-1.5 rounded-full bg-current origin-center', animated && 'animate-orb-bar')}
          style={{
            height: `${h * 100}%`,
            animationDelay: `${i * 0.12}s`,
            animationDuration: tone === 'speaking' ? '0.9s' : '1.3s',
            transform: animated ? undefined : 'scaleY(0.6)',
            opacity: 0.95,
          }}
        />
      ))}
    </div>
  );
}

function Dots({ animated }: { animated: boolean }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className={cn('block size-2.5 rounded-full bg-current', animated && 'animate-pulse-soft')} style={{ animationDelay: `${i * 0.25}s` }} />
      ))}
    </div>
  );
}
