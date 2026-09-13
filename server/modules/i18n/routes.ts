import { Router } from 'express';
import { z } from 'zod';
import { ADVISOR_LANGUAGES, type TranslateResponse } from '../../../shared/copilot.ts';
import { badRequest } from '../../lib/errors.ts';
import type { IntelligenceClient } from '../copilot/intelligenceClient.ts';

/**
 * Interface translation for the whole web app.
 *
 * Deliberately open to signed-out visitors: the sign-up and verification pages are exactly the
 * ones a person who does not read English needs translated, and they are reached before there
 * is a session. The cost of that is bounded by the caps below plus the service-side cache, which
 * means a given string is only ever sent to Gemini once per language per process.
 */

/** Strings per request. The service caps at 200; this keeps a single page well inside that. */
const MAX_STRINGS = 200;
const MAX_STRING_LENGTH = 600;
/** Requests per IP per window, enough for a page or two of fresh strings. */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

const translateSchema = z.object({
  language: z.enum(ADVISOR_LANGUAGES),
  strings: z.array(z.string().max(MAX_STRING_LENGTH)).max(MAX_STRINGS),
});

interface Window {
  count: number;
  resetAt: number;
}

export function createI18nRouter(intelligence: IntelligenceClient): Router {
  const router = Router();
  const windows = new Map<string, Window>();

  const allow = (key: string): boolean => {
    const now = Date.now();
    const current = windows.get(key);
    if (!current || now >= current.resetAt) {
      windows.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
      if (windows.size > 5_000) {
        for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k);
      }
      return true;
    }
    current.count += 1;
    return current.count <= RATE_LIMIT;
  };

  router.post('/translate', async (req, res) => {
    const parsed = translateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('A language and up to 200 strings are required.');

    const { language, strings } = parsed.data;
    // English is what the interface is written in; nothing to translate, and no round trip.
    if (language === 'en' || strings.length === 0) {
      const empty: TranslateResponse = { language, provider: 'none', translations: {} };
      res.json(empty);
      return;
    }
    if (!allow(req.ip ?? 'unknown')) {
      res.status(429).json({ error: { code: 'rate_limited', message: 'Too many translation requests. Try again in a minute.', retryable: true } });
      return;
    }

    res.json(await intelligence.translate(language, strings));
  });

  return router;
}
