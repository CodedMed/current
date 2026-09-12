import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AdvisorReply, ProposedAction } from '../../../../shared/copilot.ts';
import { MAX_HISTORY_TURNS, SUGGESTED_QUESTIONS, actionKey, newMessageId, toHistory, todoFromAction, type ConversationMessage } from './conversation.ts';

const reply: AdvisorReply = {
  answer: 'You hold $8,000. A $1,200 gap is projected on 2026-10-09.',
  summary: 'Projected shortfall of $1,200 on 2026-10-09.',
  risks: [{ title: 'Upcoming cash gap', severity: 'HIGH', explanation: 'Outflows exceed inflows.' }],
  proposedActions: [
    { title: 'Follow up with Client A', rationale: 'The $4,000 invoice is 12 days overdue.', priority: 'HIGH', dueDate: '2026-09-15', estimatedImpact: 4000 },
    { title: 'Set aside cash for the tax payment', rationale: 'Largest outflow before the gap.', priority: 'MEDIUM', dueDate: null, estimatedImpact: null },
  ],
  meta: { provider: 'mock', model: null, language: 'en', channel: 'text', fallbackReason: null },
};

function user(content: string, id = newMessageId()): ConversationMessage {
  return { id, role: 'user', content, createdAt: 1, channel: 'text' };
}
function advisor(question: string, r: AdvisorReply | null, error: ConversationMessage['role'] extends never ? never : { message: string; retryable: boolean } | null = null): ConversationMessage {
  return { id: newMessageId(), role: 'advisor', createdAt: 2, channel: 'text', question, reply: r, spoken: null, error };
}

describe('history sent back with a follow-up', () => {
  it('contains settled user and advisor turns only, oldest first', () => {
    const thread = [user('How am I doing?'), advisor('How am I doing?', reply), user('And next?'), advisor('And next?', null, { message: 'down', retryable: true })];
    assert.deepEqual(toHistory(thread), [
      { role: 'user', content: 'How am I doing?' },
      { role: 'advisor', content: reply.answer },
      { role: 'user', content: 'And next?' },
    ]);
  });

  it('is capped to the most recent turns and clips very long content', () => {
    const thread: ConversationMessage[] = [];
    for (let i = 0; i < 20; i += 1) thread.push(user(`q${i}`), advisor(`q${i}`, { ...reply, answer: `a${i}` }));
    const history = toHistory(thread);
    assert.equal(history.length, MAX_HISTORY_TURNS);
    assert.deepEqual(history.at(-1), { role: 'advisor', content: 'a19' });
    const long = toHistory([user('x'.repeat(10_000))]);
    assert.equal(long[0]?.content.length, 4000);
  });

  it('never includes financial context: only role and content travel', () => {
    for (const turn of toHistory([user('q'), advisor('q', reply)])) assert.deepEqual(Object.keys(turn).sort(), ['content', 'role']);
  });

  it('uses the spoken transcript for voice turns that had no structured reply', () => {
    const spoken: ConversationMessage = { id: 'v', role: 'advisor', createdAt: 3, channel: 'voice', question: 'hi', reply: null, spoken: 'Hello, how can I help?', error: null };
    assert.deepEqual(toHistory([spoken]), [{ role: 'advisor', content: 'Hello, how can I help?' }]);
  });
});

describe('recommendation → task', () => {
  const action = reply.proposedActions[0] as ProposedAction;

  it('creates an ADVISOR task that the owner has approved, with the rationale and impact preserved', () => {
    const todo = todoFromAction(action, { question: 'What should I do first?', language: 'en', channel: 'text' });
    assert.equal(todo.title, 'Follow up with Client A');
    assert.equal(todo.source, 'ADVISOR');
    assert.equal(todo.status, 'APPROVED');
    assert.equal(todo.priority, 'HIGH');
    assert.equal(todo.dueDate, '2026-09-15');
    assert.equal(todo.description, 'The $4,000 invoice is 12 days overdue. Estimated impact: $4,000.');
    assert.deepEqual(todo.metadata, { origin: 'advisor', approvedByOwner: true, question: 'What should I do first?', language: 'en', channel: 'text', estimatedImpact: 4000 });
  });

  it('handles actions without a deadline or impact', () => {
    const todo = todoFromAction(reply.proposedActions[1] as ProposedAction, { question: 'q', language: 'es', channel: 'voice' });
    assert.equal(todo.dueDate, null);
    assert.equal(todo.description, 'Largest outflow before the gap.');
    assert.equal(todo.metadata?.channel, 'voice');
  });

  it('keys actions per reply so "added" state survives re-renders', () => {
    assert.equal(actionKey('m1', 0), 'm1:0');
    assert.notEqual(actionKey('m1', 0), actionKey('m2', 0));
  });
});

describe('suggested questions', () => {
  it('exist for every supported language', () => {
    assert.ok(SUGGESTED_QUESTIONS.en.length >= 4);
    assert.ok(SUGGESTED_QUESTIONS.es.length >= 4);
  });
});
