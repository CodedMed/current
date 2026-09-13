/**
 * The translator against a real DOM.
 *
 * The case that matters most is attach → detach → attach: React's StrictMode does exactly that on
 * an ordinary page load, and a scheduler left believing work is already queued makes the whole
 * page silently stop translating while everything else still looks fine.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Window } from 'happy-dom';
import type { AdvisorLanguage, TranslateResponse } from '../../../../shared/copilot.ts';
import { Translator } from './translator.ts';

const DICTIONARY: Record<string, string> = {
  'Available cash': 'Beschikbaar saldo',
  Sync: 'Synchroniseren',
  'Synced just now': 'Zojuist gesynchroniseerd',
  'Add transaction': 'Transactie toevoegen',
  'Search invoices': 'Facturen zoeken',
};

let window: Window;
let requests: string[][] = [];

/** Lets queued frames and the flush timer run, then waits for the request they started. */
async function settle(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function makeTranslator(onRequest?: () => void) {
  return new Translator({
    fetchTranslations: async (language: AdvisorLanguage, strings: string[]): Promise<TranslateResponse> => {
      requests.push(strings);
      onRequest?.();
      return {
        language,
        provider: 'gemini',
        translations: Object.fromEntries(strings.filter((s) => s in DICTIONARY).map((s) => [s, DICTIONARY[s] as string])),
      };
    },
  });
}

beforeEach(() => {
  window = new Window({ url: 'https://localhost' });
  requests = [];
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = window;
  g.document = window.document;
  g.MutationObserver = window.MutationObserver;
  g.NodeFilter = window.NodeFilter;
  g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number;
  g.cancelAnimationFrame = (handle: number) => clearTimeout(handle as unknown as NodeJS.Timeout);
  window.document.body.innerHTML = `
    <header><span>Available cash</span><span>Synced just now</span><button title="Sync">Sync</button></header>
    <input placeholder="Search invoices" />
    <span>$8,000.00</span>
  `;
});

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const key of ['window', 'document', 'MutationObserver', 'NodeFilter', 'requestAnimationFrame', 'cancelAnimationFrame', 'fetch']) delete g[key];
});

/** Serves a pack for any language, so the pack path can be exercised without the network. */
function stubPack(entries: Record<string, string>) {
  const g = globalThis as unknown as Record<string, unknown>;
  g.fetch = async () => new Response(JSON.stringify(entries), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('Translator against a DOM', () => {
  it('translates the text and the reader-facing attributes', async () => {
    const translator = makeTranslator();
    translator.attach(window.document.body as unknown as HTMLElement);
    translator.setLanguage('nl');
    await settle();

    assert.match(window.document.body.textContent ?? '', /Beschikbaar saldo/);
    assert.match(window.document.body.textContent ?? '', /Zojuist gesynchroniseerd/);
    assert.equal(window.document.querySelector('button')?.getAttribute('title'), 'Synchroniseren');
    assert.equal(window.document.querySelector('input')?.getAttribute('placeholder'), 'Facturen zoeken');
  });

  it('leaves figures alone', async () => {
    const translator = makeTranslator();
    translator.attach(window.document.body as unknown as HTMLElement);
    translator.setLanguage('nl');
    await settle();

    assert.match(window.document.body.textContent ?? '', /\$8,000\.00/);
    assert.ok(!requests.flat().includes('$8,000.00'));
  });

  it('still translates after a detach and re-attach (React StrictMode)', async () => {
    const translator = makeTranslator();
    const body = window.document.body as unknown as HTMLElement;

    // Exactly what StrictMode does: mount, set the language, unmount, mount again.
    translator.attach(body);
    translator.setLanguage('nl');
    translator.detach();
    translator.attach(body);
    await settle();

    assert.match(window.document.body.textContent ?? '', /Beschikbaar saldo/);
  });

  it('restores the English it started from when switching back', async () => {
    const translator = makeTranslator();
    translator.attach(window.document.body as unknown as HTMLElement);
    translator.setLanguage('nl');
    await settle();
    translator.setLanguage('en');

    assert.match(window.document.body.textContent ?? '', /Available cash/);
    assert.equal(window.document.querySelector('button')?.getAttribute('title'), 'Sync');
  });

  it('translates text React renders after the language was chosen', async () => {
    const translator = makeTranslator();
    translator.attach(window.document.body as unknown as HTMLElement);
    translator.setLanguage('nl');
    await settle();

    const added = window.document.createElement('p');
    added.textContent = 'Add transaction';
    window.document.body.appendChild(added);
    await settle();

    assert.equal(added.textContent, 'Transactie toevoegen');
  });

  it('asks for a string only once, even as the page keeps changing', async () => {
    const translator = makeTranslator();
    translator.attach(window.document.body as unknown as HTMLElement);
    translator.setLanguage('nl');
    await settle();

    const asked = requests.flat().filter((s) => s === 'Available cash').length;
    const extra = window.document.createElement('div');
    extra.textContent = 'Available cash';
    window.document.body.appendChild(extra);
    await settle();

    assert.equal(requests.flat().filter((s) => s === 'Available cash').length, asked);
  });
});

describe('Translator with a pre-translated pack', () => {
  it('uses the pack and never asks the model for what it covers', async () => {
    stubPack({ 'Available cash': 'Beschikbaar saldo', 'Synced just now': 'Zojuist gesynchroniseerd', Sync: 'Synchroniseren', 'Search invoices': 'Facturen zoeken' });
    const translator = makeTranslator();
    translator.attach(window.document.body as unknown as HTMLElement);
    translator.setLanguage('nl');
    await settle();

    assert.match(window.document.body.textContent ?? '', /Beschikbaar saldo/);
    assert.equal(window.document.querySelector('input')?.getAttribute('placeholder'), 'Facturen zoeken');
    assert.deepEqual(requests, [], 'the pack covered everything, so no request should have been made');
  });

  it('asks the model only for what the pack is missing', async () => {
    stubPack({ 'Available cash': 'Beschikbaar saldo' });
    const translator = makeTranslator();
    translator.attach(window.document.body as unknown as HTMLElement);
    translator.setLanguage('nl');
    await settle();

    const asked = requests.flat();
    assert.ok(!asked.includes('Available cash'), 'the pack already had this one');
    assert.ok(asked.includes('Synced just now'), 'this one was not in the pack');
  });

  it('falls back to the model when no pack exists for the language', async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    g.fetch = async () => new Response('not found', { status: 404 });
    const translator = makeTranslator();
    translator.attach(window.document.body as unknown as HTMLElement);
    translator.setLanguage('nl');
    await settle();

    assert.match(window.document.body.textContent ?? '', /Beschikbaar saldo/);
    assert.ok(requests.flat().includes('Available cash'));
  });
});
