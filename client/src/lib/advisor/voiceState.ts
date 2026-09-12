/**
 * Voice conversation state, reduced from the events the ElevenLabs client actually emits. No
 * timers: every transition below is caused by a real SDK callback, a real request lifecycle, or a
 * user action, so the animation always shows what the conversation is doing.
 *
 *   idle ─start→ connecting ─connected→ listening ─user transcript→ thinking ─agent audio→ speaking ─audio done→ listening
 *                    │                                         │ (client tool runs the advisor pipeline)
 *                    └──failure──→ error ←──────────────────────┘
 */

export type VoiceState = 'idle' | 'unavailable' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

export type VoiceEvent =
  /** The owner pressed start. */
  | { type: 'start' }
  /** The BFF reported that voice is not configured (no ElevenLabs credentials). */
  | { type: 'unavailable'; reason: string }
  /** `onStatusChange` from the SDK. */
  | { type: 'status'; status: 'connecting' | 'connected' | 'disconnecting' | 'disconnected' }
  /** `onModeChange` from the SDK: the agent is producing audio, or waiting for the user. */
  | { type: 'mode'; mode: 'listening' | 'speaking' }
  /** `onMessage` with the user's final transcript: their turn is over, the agent is working. */
  | { type: 'user_transcript' }
  /** The agent invoked our client tool: the advisor pipeline (ledger → Gemini) is running. */
  | { type: 'tool_start' }
  | { type: 'tool_end' }
  /** `onError`, a failed session request, a denied microphone, or a disconnect with an error. */
  | { type: 'error'; message: string }
  /** `onDisconnect` from the SDK. */
  | { type: 'disconnected'; reason: 'user' | 'agent' | 'error'; message?: string }
  /** The owner ended the session or switched modes. */
  | { type: 'reset' };

export interface VoiceSnapshot {
  state: VoiceState;
  /** Human-readable detail for the error and unavailable states. */
  message: string | null;
  /** True while the client tool (the advisor request) is in flight. */
  toolInFlight: boolean;
}

export const INITIAL_VOICE: VoiceSnapshot = { state: 'idle', message: null, toolInFlight: false };

const ACTIVE: ReadonlySet<VoiceState> = new Set(['connecting', 'listening', 'thinking', 'speaking']);

export function isVoiceActive(state: VoiceState): boolean {
  return ACTIVE.has(state);
}

export function reduceVoice(snapshot: VoiceSnapshot, event: VoiceEvent): VoiceSnapshot {
  switch (event.type) {
    case 'start':
      return { state: 'connecting', message: null, toolInFlight: false };
    case 'unavailable':
      return { state: 'unavailable', message: event.reason, toolInFlight: false };
    case 'reset':
      return INITIAL_VOICE;
    case 'error':
      return { state: 'error', message: event.message, toolInFlight: false };
    case 'disconnected':
      if (event.reason === 'error') return { state: 'error', message: event.message ?? 'The voice connection was lost.', toolInFlight: false };
      // The agent hung up, or the owner did: either way the session is over.
      return snapshot.state === 'error' ? snapshot : INITIAL_VOICE;
    case 'status':
      if (event.status === 'connected' && snapshot.state === 'connecting') return { ...snapshot, state: 'listening', message: null };
      if (event.status === 'disconnected') return snapshot.state === 'error' ? snapshot : INITIAL_VOICE;
      return snapshot;
    case 'mode':
      if (!isVoiceActive(snapshot.state)) return snapshot;
      if (event.mode === 'speaking') return { ...snapshot, state: 'speaking' };
      // Back to listening, unless our tool is still running (the agent waits for its result).
      return { ...snapshot, state: snapshot.toolInFlight ? 'thinking' : 'listening' };
    case 'user_transcript':
      return isVoiceActive(snapshot.state) && snapshot.state !== 'speaking' ? { ...snapshot, state: 'thinking' } : snapshot;
    case 'tool_start':
      return isVoiceActive(snapshot.state) ? { ...snapshot, state: 'thinking', toolInFlight: true } : snapshot;
    case 'tool_end':
      // Stay in thinking: the agent has the answer and will start speaking (mode → speaking) next.
      return { ...snapshot, toolInFlight: false };
    default:
      return snapshot;
  }
}

/** Maps a thrown start-up failure onto a sentence the owner can act on. */
export function describeVoiceStartError(err: unknown, language: 'en' | 'es' = 'en'): string {
  const es = language === 'es';
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (name === 'NotAllowedError' || /permission|denied/i.test(message)) {
    return es ? 'El navegador bloqueó el micrófono. Permite el acceso al micrófono y vuelve a intentarlo.' : 'Microphone access was blocked. Allow the microphone for this site and try again.';
  }
  if (name === 'NotFoundError' || /no (audio|microphone)|device not found/i.test(message)) {
    return es ? 'No se encontró ningún micrófono.' : 'No microphone was found on this device.';
  }
  if (/secure context|getUserMedia|mediaDevices/i.test(message)) {
    return es ? 'La voz requiere una conexión segura (HTTPS o localhost).' : 'Voice needs a secure connection (HTTPS or localhost).';
  }
  if (message) return es ? `No se pudo iniciar la conversación de voz: ${message}` : `The voice conversation could not start: ${message}`;
  return es ? 'No se pudo iniciar la conversación de voz.' : 'The voice conversation could not start.';
}
