import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INITIAL_VOICE, describeVoiceStartError, isVoiceActive, reduceVoice, type VoiceEvent, type VoiceSnapshot } from './voiceState.ts';

function run(events: VoiceEvent[], from: VoiceSnapshot = INITIAL_VOICE): VoiceSnapshot {
  return events.reduce(reduceVoice, from);
}

describe('voice state follows real conversation events', () => {
  it('goes idle → connecting → listening when the session connects', () => {
    assert.equal(run([{ type: 'start' }]).state, 'connecting');
    assert.equal(run([{ type: 'start' }, { type: 'status', status: 'connecting' }]).state, 'connecting');
    assert.equal(run([{ type: 'start' }, { type: 'status', status: 'connected' }]).state, 'listening');
  });

  it('moves to thinking when the user finishes speaking and while the advisor tool runs', () => {
    const listening = run([{ type: 'start' }, { type: 'status', status: 'connected' }]);
    const afterTranscript = reduceVoice(listening, { type: 'user_transcript' });
    assert.equal(afterTranscript.state, 'thinking');
    const toolRunning = reduceVoice(afterTranscript, { type: 'tool_start' });
    assert.equal(toolRunning.state, 'thinking');
    assert.equal(toolRunning.toolInFlight, true);
    // A stray "listening" mode change while the tool is still running does not hide the work.
    assert.equal(reduceVoice(toolRunning, { type: 'mode', mode: 'listening' }).state, 'thinking');
    const toolDone = reduceVoice(toolRunning, { type: 'tool_end' });
    assert.equal(toolDone.state, 'thinking');
    assert.equal(toolDone.toolInFlight, false);
  });

  it('shows speaking only while the agent produces audio, then returns to listening', () => {
    const thinking = run([{ type: 'start' }, { type: 'status', status: 'connected' }, { type: 'user_transcript' }, { type: 'tool_start' }, { type: 'tool_end' }]);
    const speaking = reduceVoice(thinking, { type: 'mode', mode: 'speaking' });
    assert.equal(speaking.state, 'speaking');
    const back = reduceVoice(speaking, { type: 'mode', mode: 'listening' });
    assert.equal(back.state, 'listening');
  });

  it('never gets stuck: every busy state has a way back to idle or listening', () => {
    for (const busy of ['thinking', 'speaking', 'connecting'] as const) {
      const snapshot: VoiceSnapshot = { state: busy, message: null, toolInFlight: busy === 'thinking' };
      assert.equal(reduceVoice(snapshot, { type: 'disconnected', reason: 'user' }).state, 'idle');
      assert.equal(reduceVoice(snapshot, { type: 'disconnected', reason: 'agent' }).state, 'idle');
      assert.equal(reduceVoice(snapshot, { type: 'reset' }).state, 'idle');
      assert.equal(reduceVoice(snapshot, { type: 'error', message: 'x' }).state, 'error');
    }
    const thinking: VoiceSnapshot = { state: 'thinking', message: null, toolInFlight: false };
    assert.equal(reduceVoice(thinking, { type: 'mode', mode: 'listening' }).state, 'listening');
  });

  it('surfaces failures as error with a message, and a retry starts a fresh connection', () => {
    const failed = run([{ type: 'start' }, { type: 'error', message: 'Microphone access was blocked.' }]);
    assert.equal(failed.state, 'error');
    assert.equal(failed.message, 'Microphone access was blocked.');
    // A disconnect that follows an error keeps the error visible instead of silently going idle.
    assert.equal(reduceVoice(failed, { type: 'status', status: 'disconnected' }).state, 'error');
    assert.equal(reduceVoice(failed, { type: 'disconnected', reason: 'error', message: 'lost' }).message, 'lost');
    assert.equal(reduceVoice(failed, { type: 'start' }).state, 'connecting');
  });

  it('reports voice as unavailable, with the reason, when the BFF says so', () => {
    const snapshot = run([{ type: 'start' }, { type: 'unavailable', reason: 'ELEVENLABS_API_KEY is not configured; the advisor stays on text.' }]);
    assert.equal(snapshot.state, 'unavailable');
    assert.match(snapshot.message ?? '', /ELEVENLABS_API_KEY/);
    assert.equal(isVoiceActive(snapshot.state), false);
  });

  it('ignores mode and transcript events when no session is active', () => {
    assert.equal(reduceVoice(INITIAL_VOICE, { type: 'mode', mode: 'speaking' }).state, 'idle');
    assert.equal(reduceVoice(INITIAL_VOICE, { type: 'user_transcript' }).state, 'idle');
    assert.equal(reduceVoice(INITIAL_VOICE, { type: 'tool_start' }).state, 'idle');
  });
});

describe('start-up failures are explained', () => {
  it('recognises a denied microphone', () => {
    const err = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    assert.match(describeVoiceStartError(err), /Microphone access was blocked/);
    assert.match(describeVoiceStartError(err, 'es'), /micrófono/);
  });
  it('recognises a missing microphone and falls back to the raw message otherwise', () => {
    assert.match(describeVoiceStartError(Object.assign(new Error('x'), { name: 'NotFoundError' })), /No microphone/);
    assert.match(describeVoiceStartError(new Error('socket closed')), /socket closed/);
    assert.match(describeVoiceStartError(undefined), /could not start/);
  });
});
