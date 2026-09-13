/**
 * The filter that decides what is worth translating. Everything else in the translator needs a
 * DOM; this is the part that decides what the user's Gemini budget is spent on.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { translatable } from './translator.ts';

describe('translatable', () => {
  it('takes prose a person reads', () => {
    assert.ok(translatable('Available cash'));
    assert.ok(translatable('Your documents go directly to Persona.'));
    assert.ok(translatable('30 days'));
  });

  it('leaves figures, symbols and separators alone', () => {
    for (const text of ['$8,000.00', '2026-09-13', '—', '•', '12', '+4.2%', ' ', '']) {
      assert.equal(translatable(text), false, `expected ${JSON.stringify(text)} to be skipped`);
    }
  });

  it('skips a lone letter but keeps a real word', () => {
    assert.equal(translatable('a'), false);
    assert.equal(translatable('A'), false);
    assert.ok(translatable('No'));
  });

  it('skips anything longer than one interface string', () => {
    assert.equal(translatable('word '.repeat(200)), false);
  });
});
