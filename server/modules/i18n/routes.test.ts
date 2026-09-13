/**
 * The translation route is open to signed-out visitors, so its job is to stay cheap and safe:
 * English never leaves the process, oversized requests are refused, and a flood is rate limited.
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import type { TranslateResponse } from '../../../shared/copilot.ts';
import { errorHandler } from '../../lib/errors.ts';
import type { IntelligenceClient } from '../copilot/intelligenceClient.ts';
import { createI18nRouter } from './routes.ts';

interface Call {
  language: string;
  strings: string[];
}

function harness() {
  const calls: Call[] = [];
  const intelligence = {
    translate: async (language: string, strings: string[]): Promise<TranslateResponse> => {
      calls.push({ language, strings });
      return {
        language: language as TranslateResponse['language'],
        provider: 'gemini',
        translations: Object.fromEntries(strings.map((s) => [s, `${s}!`])),
      };
    },
  } as unknown as IntelligenceClient;

  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/i18n', createI18nRouter(intelligence));
  app.use(errorHandler);
  return { app, calls };
}

describe('POST /api/i18n/translate', () => {
  const h = harness();
  let base = '';
  let server: ReturnType<typeof h.app.listen>;

  before(async () => {
    server = h.app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  const post = (body: unknown) =>
    fetch(`${base}/api/i18n/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('translates a batch and returns a map back', async () => {
    const res = await post({ language: 'es', strings: ['Available cash', 'Add task'] });
    assert.equal(res.status, 200);
    const body = (await res.json()) as TranslateResponse;
    assert.equal(body.translations['Available cash'], 'Available cash!');
    assert.deepEqual(h.calls.at(-1)?.strings, ['Available cash', 'Add task']);
  });

  it('never sends English upstream', async () => {
    const before = h.calls.length;
    const res = await post({ language: 'en', strings: ['Available cash'] });
    assert.equal(res.status, 200);
    const body = (await res.json()) as TranslateResponse;
    assert.deepEqual(body, { language: 'en', provider: 'none', translations: {} });
    assert.equal(h.calls.length, before);
  });

  it('refuses a language the app does not offer', async () => {
    const res = await post({ language: 'sv', strings: ['Available cash'] });
    assert.equal(res.status, 400);
  });

  it('refuses more strings than one page could hold', async () => {
    const res = await post({ language: 'es', strings: Array.from({ length: 201 }, (_, i) => `string ${i}`) });
    assert.equal(res.status, 400);
  });

  it('rate limits a flood from one caller', async () => {
    // The limit is 60 a minute; the calls above already used some of this window.
    let limited = false;
    for (let i = 0; i < 70 && !limited; i += 1) {
      const res = await post({ language: 'es', strings: [`flood ${i}`] });
      if (res.status === 429) limited = true;
      else await res.arrayBuffer();
    }
    assert.ok(limited, 'expected a 429 once the window filled');
  });
});
