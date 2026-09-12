import type { VoiceConversation } from '@elevenlabs/client';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { AdvisorLanguage, AdvisorReply, AdvisorTurn } from '../../../shared/copilot.ts';
import { ApiError, api } from '../lib/api.ts';
import { INITIAL_VOICE, describeVoiceStartError, reduceVoice, type VoiceSnapshot } from '../lib/advisor/voiceState.ts';

/** Registered when the BFF does not name one; kept in step with the intelligence service. */
const DEFAULT_CLIENT_TOOL = 'ask_cash_flow_advisor';

export interface VoiceAdvisorHandlers {
  /** The user's final transcript for a turn (what ElevenLabs heard). */
  onUserTranscript: (text: string) => void;
  /** The structured reply the shared advisor pipeline produced for a spoken question. */
  onAdvisorReply: (question: string, reply: AdvisorReply) => void;
  onAdvisorError: (question: string, message: string, retryable: boolean) => void;
  /** Agent speech that did not come from the advisor tool (greetings, clarifications). */
  onAgentMessage: (text: string) => void;
  /** Prior turns to send with the next advisor request, for continuity. */
  history: () => AdvisorTurn[];
}

export interface VoiceAdvisor {
  snapshot: VoiceSnapshot;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Sends typed text into the live voice session. False when no session is open. */
  sendText: (text: string) => boolean;
  setMicMuted: (muted: boolean) => void;
  inputVolume: () => number;
  outputVolume: () => number;
}

/**
 * Drives an ElevenLabs Conversational AI session and reduces its real events into the voice
 * state the UI shows. The agent handles speech and turn-taking; every financial answer comes from
 * the client tool below, which calls the BFF's `/voice/message` and therefore the same
 * ledger → intelligence → Gemini pipeline as the text advisor. The signed URL is minted
 * server-side, so no ElevenLabs credential ever reaches this code.
 */
export function useVoiceAdvisor(language: AdvisorLanguage, handlers: VoiceAdvisorHandlers): VoiceAdvisor {
  const [snapshot, dispatch] = useReducer(reduceVoice, INITIAL_VOICE);
  const conversationRef = useRef<VoiceConversation | null>(null);
  const handlersRef = useRef(handlers);
  const languageRef = useRef(language);
  const lastTranscriptRef = useRef('');
  /** Set after the tool answered so the agent's spoken rendition is not shown twice. */
  const toolAnsweredRef = useRef(false);
  const startingRef = useRef(false);

  useEffect(() => {
    handlersRef.current = handlers;
  });
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  const stop = useCallback(async () => {
    const conversation = conversationRef.current;
    conversationRef.current = null;
    dispatch({ type: 'reset' });
    if (conversation) {
      try {
        await conversation.endSession();
      } catch {
        // Ending an already-closed session is not an error worth showing.
      }
    }
  }, []);

  const start = useCallback(async () => {
    if (startingRef.current || conversationRef.current) return;
    startingRef.current = true;
    const lang = languageRef.current;
    dispatch({ type: 'start' });
    try {
      const session = await api.copilot.voice.session(lang);
      if (!session.available || !session.signedUrl) {
        dispatch({ type: 'unavailable', reason: session.reason ?? 'Voice is not configured.' });
        return;
      }
      const toolName = session.clientToolName ?? DEFAULT_CLIENT_TOOL;
      // The SDK (and its WebRTC dependency) is only worth downloading once a voice session starts.
      const { Conversation } = await import('@elevenlabs/client');

      const conversation = await Conversation.startSession({
        signedUrl: session.signedUrl,
        connectionType: 'websocket',
        textOnly: false,
        overrides: { agent: { language: lang } },
        clientTools: {
          [toolName]: async (parameters: unknown) => {
            const fromAgent = typeof parameters === 'object' && parameters !== null ? (parameters as { question?: unknown }).question : undefined;
            const question = (typeof fromAgent === 'string' && fromAgent.trim() ? fromAgent : lastTranscriptRef.current).trim();
            if (!question) {
              return lang === 'es' ? 'No entendí la pregunta. ¿Puedes repetirla?' : 'I did not catch a question. Could you ask it again?';
            }
            dispatch({ type: 'tool_start' });
            try {
              const reply = await api.copilot.voice.message(question, lang, handlersRef.current.history());
              handlersRef.current.onAdvisorReply(question, reply);
              toolAnsweredRef.current = true;
              return reply.answer;
            } catch (err) {
              const message = err instanceof ApiError ? err.message : lang === 'es' ? 'El asesor no está disponible ahora mismo.' : 'The advisor is unavailable right now.';
              handlersRef.current.onAdvisorError(question, message, err instanceof ApiError ? err.retryable : true);
              toolAnsweredRef.current = true;
              return lang === 'es'
                ? `No pude consultar los datos financieros: ${message} Dilo al usuario y sugiere intentarlo de nuevo.`
                : `I could not reach the financial data: ${message} Tell the user and suggest trying again.`;
            } finally {
              dispatch({ type: 'tool_end' });
            }
          },
        },
        onStatusChange: ({ status }) => dispatch({ type: 'status', status }),
        onModeChange: ({ mode }) => dispatch({ type: 'mode', mode }),
        onMessage: ({ message, role }) => {
          if (role === 'user') {
            lastTranscriptRef.current = message;
            handlersRef.current.onUserTranscript(message);
            dispatch({ type: 'user_transcript' });
            return;
          }
          if (toolAnsweredRef.current) {
            // The structured reply is already in the thread; this is the agent reading it aloud.
            toolAnsweredRef.current = false;
            return;
          }
          handlersRef.current.onAgentMessage(message);
        },
        onError: (message) => dispatch({ type: 'error', message: String(message) }),
        onDisconnect: (details) => {
          conversationRef.current = null;
          dispatch({ type: 'disconnected', reason: details.reason, message: details.reason === 'error' ? details.message : undefined });
        },
        onUnhandledClientToolCall: (call) => {
          dispatch({
            type: 'error',
            message:
              lang === 'es'
                ? `El agente de voz pidió una herramienta llamada "${call.tool_name}" que esta aplicación no ofrece. Configura la herramienta de cliente del agente como "${toolName}".`
                : `The voice agent asked for a tool named "${call.tool_name}" that this app does not provide. Configure the agent's client tool as "${toolName}".`,
          });
        },
      });
      conversationRef.current = conversation;
      // The SDK reports "connected" before this promise resolves on some paths; make sure we reflect it.
      if (conversation.isOpen()) dispatch({ type: 'status', status: 'connected' });
    } catch (err) {
      if (err instanceof ApiError) {
        dispatch({ type: 'error', message: err.message });
      } else {
        dispatch({ type: 'error', message: describeVoiceStartError(err, lang) });
      }
      const dangling = conversationRef.current;
      conversationRef.current = null;
      if (dangling) void dangling.endSession().catch(() => {});
    } finally {
      startingRef.current = false;
    }
  }, []);

  useEffect(
    () => () => {
      const conversation = conversationRef.current;
      conversationRef.current = null;
      if (conversation) void conversation.endSession().catch(() => {});
    },
    [],
  );

  const sendText = useCallback((text: string) => {
    const conversation = conversationRef.current;
    if (!conversation || !conversation.isOpen()) return false;
    conversation.sendUserMessage(text);
    return true;
  }, []);

  const setMicMuted = useCallback((muted: boolean) => {
    conversationRef.current?.setMicMuted(muted);
  }, []);

  const inputVolume = useCallback(() => conversationRef.current?.getInputVolume() ?? 0, []);
  const outputVolume = useCallback(() => conversationRef.current?.getOutputVolume() ?? 0, []);

  return { snapshot, start, stop, sendText, setMicMuted, inputVolume, outputVolume };
}
