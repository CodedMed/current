import type { AdvisorLanguage, TranslateResponse } from '../../../../shared/copilot.ts';

/**
 * Translates the live interface.
 *
 * Rather than requiring every component to be rewritten around a `t()` call, this walks the
 * rendered DOM, collects the text a person can actually read, and swaps it for a translation.
 * That has three consequences worth knowing about:
 *
 *  - it covers text this codebase never wrote: category names, merchant names, advisor answers,
 *    task titles — the parts of the page that come from the user's own data;
 *  - a component can re-render and put English back, so a MutationObserver re-applies from the
 *    cache, which is synchronous once a string has been seen;
 *  - the original text is kept per node, so switching back to English is exact rather than a
 *    second, lossy translation.
 */

/** Elements whose text is code, markup or user input, and must never be rewritten. */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA', 'IFRAME']);
/** Attributes that hold reader-facing text. */
const TEXT_ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt'] as const;

const MAX_BATCH = 180;
/** Where the pre-translated interface strings live, one file per language. */
const PACK_URL = (language: string) => `/i18n/${language}.json`;
/** How long to wait after a failed request before trying the same strings again. */
const RETRY_COOLDOWN_MS = 15_000;
const CACHE_PREFIX = 'keel.i18n.';
const CACHE_LIMIT = 3_000;

export type TranslationStatus = 'idle' | 'translating' | 'ready' | 'unavailable';

/** Text worth sending: something a person reads, not a number, a symbol or a single letter. */
export function translatable(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 600) return false;
  // Two adjacent letters somewhere: "$8,000.00", "30d", "—" and "…" are all left alone.
  return /\p{L}\p{L}/u.test(trimmed);
}

function skipped(element: Element): boolean {
  return (
    SKIP_TAGS.has(element.tagName.toUpperCase()) ||
    element.hasAttribute('data-no-translate') ||
    element.getAttribute('translate') === 'no'
  );
}

function loadCache(language: AdvisorLanguage): Map<string, string> {
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + language);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return new Map();
    return new Map(Object.entries(parsed as Record<string, string>));
  } catch {
    // A private window, cleared site data, or a quota error: start cold rather than fail.
    return new Map();
  }
}

function saveCache(language: AdvisorLanguage, cache: Map<string, string>): void {
  try {
    const entries = [...cache.entries()].slice(-CACHE_LIMIT);
    window.localStorage.setItem(CACHE_PREFIX + language, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Nothing to do: the in-memory cache still serves this session.
  }
}

export interface TranslatorOptions {
  /** Sends a batch of strings for translation. Anything absent from the result stays English. */
  fetchTranslations: (language: AdvisorLanguage, strings: string[]) => Promise<TranslateResponse>;
  onStatus?: (status: TranslationStatus) => void;
}

export class Translator {
  #language: AdvisorLanguage = 'en';
  #cache = new Map<string, string>();
  /**
   * The strings this app renders, translated ahead of time and served as a static file. Keeping
   * them out of `#cache` keeps them out of localStorage too: the browser already caches the file,
   * and storage is for the strings only this user's data produced.
   */
  #pack = new Map<string, string>();
  /** Resolves once the pack for the current language has been fetched, or has failed. */
  #packReady: Promise<void> | null = null;
  /** Source text per node, so English is restored exactly and never re-translated in place. */
  readonly #originalText = new WeakMap<Text, string>();
  readonly #originalAttrs = new WeakMap<Element, Map<string, string>>();
  readonly #pending = new Set<string>();
  /**
   * Strings a completed request did not translate. Without this they would be requested again
   * on every re-render, forever: the DOM still shows them, so every pass would queue them anew.
   */
  readonly #untranslatable = new Set<string>();
  /** Set after a failed request so a service that is down is retried slowly, not every frame. */
  #coolUntil = 0;
  readonly #options: TranslatorOptions;
  #observer: MutationObserver | null = null;
  #applying = false;
  #scheduled = 0;
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #inFlight = 0;
  #root: HTMLElement | null = null;

  constructor(options: TranslatorOptions) {
    this.#options = options;
  }

  get language(): AdvisorLanguage {
    return this.#language;
  }

  /** Starts watching `root`. Safe to call once per app lifetime. */
  attach(root: HTMLElement): void {
    this.#root = root;
    this.#observer?.disconnect();
    this.#observer = new MutationObserver(() => {
      if (this.#applying) return;
      this.#schedule();
    });
    this.#observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TEXT_ATTRIBUTES],
    });
    if (this.#language !== 'en') this.#schedule();
  }

  /**
   * Stops watching. Every handle is cleared *and* reset: a cancelled timer whose handle is still
   * set would make `#schedule`/`#scheduleFlush` believe work was already queued and return early
   * forever after, which silently stops the whole page from translating. React's StrictMode
   * mounts, unmounts and remounts effects, so this path runs on an ordinary page load.
   */
  detach(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
    if (this.#scheduled) cancelAnimationFrame(this.#scheduled);
    this.#scheduled = 0;
  }

  setLanguage(language: AdvisorLanguage): void {
    if (language === this.#language) return;
    this.#language = language;
    this.#pending.clear();
    this.#untranslatable.clear();
    this.#coolUntil = 0;
    // Always show the source text first: switching Spanish → French must translate the English
    // the page was written in, and the reader should never see the language they just left.
    this.#cache = new Map();
    this.#pack = new Map();
    this.#packReady = null;
    this.#restore();
    if (language === 'en') {
      this.#options.onStatus?.('idle');
      return;
    }
    this.#cache = loadCache(language);
    this.#pack = new Map();
    this.#packReady = this.#loadPack(language);
    this.#apply();
  }

  #schedule(): void {
    if (this.#scheduled) return;
    this.#scheduled = requestAnimationFrame(() => {
      this.#scheduled = 0;
      if (this.#language !== 'en') this.#apply();
    });
  }

  /** Puts every touched node back to the text it was rendered with. */
  #restore(): void {
    const root = this.#root;
    if (!root) return;
    this.#applying = true;
    try {
      for (const node of this.#textNodes(root)) {
        const original = this.#originalText.get(node);
        if (original !== undefined && node.nodeValue !== original) node.nodeValue = original;
      }
      for (const element of root.querySelectorAll('*')) {
        const originals = this.#originalAttrs.get(element);
        if (!originals) continue;
        for (const [name, value] of originals) {
          if (element.getAttribute(name) !== value) element.setAttribute(name, value);
        }
      }
    } finally {
      this.#observer?.takeRecords();
      this.#applying = false;
    }
  }

  /** Applies every cached translation and queues whatever is still missing. */
  #apply(): void {
    const root = this.#root;
    if (!root) return;
    this.#applying = true;
    try {
      for (const node of this.#textNodes(root)) {
        const original = this.#originalText.get(node) ?? node.nodeValue ?? '';
        if (!translatable(original)) continue;
        if (!this.#originalText.has(node)) this.#originalText.set(node, original);
        this.#swapText(node, original);
      }
      for (const element of root.querySelectorAll('*')) {
        if (skipped(element)) continue;
        for (const name of TEXT_ATTRIBUTES) {
          const current = element.getAttribute(name);
          if (current === null) continue;
          let originals = this.#originalAttrs.get(element);
          const original = originals?.get(name) ?? current;
          if (!translatable(original)) continue;
          if (!originals) {
            originals = new Map();
            this.#originalAttrs.set(element, originals);
          }
          if (!originals.has(name)) originals.set(name, original);
          const key = original.trim();
          const translated = this.#translationOf(key);
          if (translated) {
            if (current !== translated) element.setAttribute(name, translated);
          } else if (!this.#untranslatable.has(key)) {
            this.#pending.add(key);
          }
        }
      }
    } finally {
      this.#observer?.takeRecords();
      this.#applying = false;
    }
    if (this.#pending.size > 0) this.#scheduleFlush();
  }

  /** The pack is authoritative for the app's own copy; the cache holds everything else. */
  #translationOf(key: string): string | undefined {
    return this.#pack.get(key) ?? this.#cache.get(key);
  }

  #swapText(node: Text, original: string): void {
    const key = original.trim();
    const translated = this.#translationOf(key);
    if (translated === undefined) {
      if (!this.#untranslatable.has(key)) this.#pending.add(key);
      return;
    }
    // Preserve the whitespace the layout depends on; only the words change.
    const leading = original.slice(0, original.length - original.trimStart().length);
    const trailing = original.slice(original.trimEnd().length);
    const next = leading + translated + trailing;
    if (node.nodeValue !== next) node.nodeValue = next;
  }

  /** Text nodes under `root`, skipping anything inside an element that must not be rewritten. */
  *#textNodes(root: HTMLElement): Generator<Text> {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        for (let el: Element | null = parent; el && el !== root.parentElement; el = el.parentElement) {
          if (skipped(el)) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let current = walker.nextNode();
    while (current) {
      yield current as Text;
      current = walker.nextNode();
    }
  }

  /**
   * Fetches the pre-translated pack for a language. A missing pack is not an error — it just
   * means every string goes to the model, which is what happened before packs existed.
   */
  async #loadPack(language: AdvisorLanguage): Promise<void> {
    try {
      const response = await fetch(PACK_URL(language), { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const parsed: unknown = await response.json();
      if (!parsed || typeof parsed !== 'object') return;
      if (this.#language !== language) return;
      this.#pack = new Map(Object.entries(parsed as Record<string, string>));
      this.#apply();
    } catch {
      // Offline, or no pack built for this language. The model covers it.
    }
  }

  /** Batches the strings seen in this frame into one request. */
  #scheduleFlush(): void {
    if (this.#flushTimer !== null) return;
    const delay = Math.max(60, this.#coolUntil - Date.now());
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      void this.#flush();
    }, delay);
  }

  async #flush(): Promise<void> {
    const language = this.#language;
    if (language === 'en' || this.#pending.size === 0) return;

    // Wait for the pack before spending a request: most of what is queued is usually in it.
    await this.#packReady;
    if (this.#language !== language) return;
    for (const source of this.#pending) {
      if (this.#pack.has(source)) this.#pending.delete(source);
    }
    if (this.#pending.size === 0) return;

    const batch = [...this.#pending].slice(0, MAX_BATCH);
    for (const s of batch) this.#pending.delete(s);

    this.#inFlight += 1;
    this.#options.onStatus?.('translating');
    try {
      const result = await this.#options.fetchTranslations(language, batch);
      // A language switch mid-flight makes this answer irrelevant.
      if (this.#language !== language) return;
      const entries = Object.entries(result.translations);
      for (const [source, translated] of entries) this.#cache.set(source, translated);
      // Anything the request came back without is not coming: remember that rather than ask again.
      for (const source of batch) {
        if (!this.#translationOf(source)) this.#untranslatable.add(source);
      }
      this.#coolUntil = 0;
      if (entries.length > 0) {
        saveCache(language, this.#cache);
        this.#apply();
      }
      this.#options.onStatus?.(result.provider === 'none' && entries.length === 0 ? 'unavailable' : 'ready');
    } catch {
      // The request itself failed, so these strings are worth retrying — but not immediately,
      // and not once per render. Put them back and wait.
      for (const source of batch) this.#pending.add(source);
      this.#coolUntil = Date.now() + RETRY_COOLDOWN_MS;
      this.#options.onStatus?.('unavailable');
    } finally {
      this.#inFlight -= 1;
      if (this.#inFlight === 0 && this.#pending.size > 0) this.#scheduleFlush();
    }
  }
}
