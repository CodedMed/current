/**
 * Conversation model for the advisor page, kept free of React so it can be unit-tested with the
 * Node test runner. The thread is the single source of truth for both surfaces: typed questions
 * and spoken turns land here as the same message shapes, and the history sent back to the
 * advisor is derived from it.
 */
import type { AdvisorChannel, AdvisorLanguage, AdvisorReply, AdvisorTurn, CreateTodoInput, ProposedAction } from '../../../../shared/copilot.ts';
import { money } from '../format.ts';

export interface UserMessage {
  id: string;
  role: 'user';
  content: string;
  createdAt: number;
  channel: AdvisorChannel;
}

export interface AdvisorMessage {
  id: string;
  role: 'advisor';
  createdAt: number;
  channel: AdvisorChannel;
  /** The question this reply answers, kept so a failed turn can be retried verbatim. */
  question: string;
  /** Structured reply once it arrived; null while pending or after a failure. */
  reply: AdvisorReply | null;
  /** Plain spoken text from the voice agent when no structured reply exists for the turn. */
  spoken: string | null;
  error: { message: string; retryable: boolean } | null;
}

export type ConversationMessage = UserMessage | AdvisorMessage;

/** Mirrors the intelligence service: continuity, not memory. */
export const MAX_HISTORY_TURNS = 10;
const MAX_TURN_CHARS = 4000;

function clip(text: string): string {
  return text.length > MAX_TURN_CHARS ? text.slice(0, MAX_TURN_CHARS) : text;
}

/**
 * The prior turns sent with the next question. Only settled turns count: a user question and the
 * answer it received. Pending or failed advisor turns carry no facts and are skipped.
 */
export function toHistory(messages: readonly ConversationMessage[], limit = MAX_HISTORY_TURNS): AdvisorTurn[] {
  const turns: AdvisorTurn[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      if (message.content.trim()) turns.push({ role: 'user', content: clip(message.content.trim()) });
    } else if (message.reply) {
      turns.push({ role: 'advisor', content: clip(message.reply.answer) });
    } else if (message.spoken) {
      turns.push({ role: 'advisor', content: clip(message.spoken) });
    }
  }
  return turns.slice(-limit);
}

/** Stable identity for a proposed action inside one reply, for "added" bookkeeping. */
export function actionKey(messageId: string, index: number): string {
  return `${messageId}:${index}`;
}

export interface ActionOrigin {
  question: string;
  language: AdvisorLanguage;
  channel: AdvisorChannel;
}

/**
 * Turns a recommendation the owner has explicitly accepted into a task. The click on
 * "Add to tasks" *is* the approval, so the task is created as APPROVED with source ADVISOR;
 * nothing calls this without that click, and the advisor itself never writes tasks.
 */
export function todoFromAction(action: ProposedAction, origin: ActionOrigin): CreateTodoInput {
  const impact = action.estimatedImpact !== null && Number.isFinite(action.estimatedImpact) ? money(Math.abs(action.estimatedImpact)) : null;
  const description = [action.rationale.trim(), impact ? `Estimated impact: ${impact}.` : null].filter(Boolean).join(' ');
  return {
    title: action.title.trim().slice(0, 200),
    description: description.slice(0, 2000),
    source: 'ADVISOR',
    status: 'APPROVED',
    priority: action.priority,
    dueDate: action.dueDate,
    metadata: {
      origin: 'advisor',
      approvedByOwner: true,
      question: origin.question.slice(0, 500),
      language: origin.language,
      channel: origin.channel,
      estimatedImpact: action.estimatedImpact,
    },
  };
}

export const SUGGESTED_QUESTIONS: Record<AdvisorLanguage, readonly string[]> = {
  en: [
    'How is my business doing financially?',
    'How much cash do I have available?',
    'When might I run into a cash-flow gap?',
    'Which overdue invoice should I follow up on first?',
    'What are my biggest upcoming expenses?',
    'What should I prioritize this week?',
  ],
  es: [
    '¿Cómo va mi negocio financieramente?',
    '¿Cuánto efectivo tengo disponible?',
    '¿Cuándo podría tener una brecha de efectivo?',
    '¿Qué factura vencida debo reclamar primero?',
    '¿Cuáles son mis mayores gastos próximos?',
    '¿Qué debo priorizar esta semana?',
  ],
};

export function newMessageId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
