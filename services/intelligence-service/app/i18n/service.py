"""Interface translation with a process-wide cache.

The web app asks for the strings it is about to show; every string is translated once per
language for the life of the process, and the browser caches the same answers again. A batch
that Gemini cannot translate is simply left out of the response, and the caller keeps the
English source — a failed translation must never blank out the interface.
"""

from __future__ import annotations

import asyncio
import logging

from app.config import Settings
from app.i18n.schemas import LANGUAGE_NAMES, TranslateResponse

log = logging.getLogger(__name__)

#: Strings per Gemini call. Cost is mostly fixed per call rather than per string — 10 strings
#: measured 1.7s against 2.7s for 50 — so batches are large, and the whole page usually fits in
#: one round.
BATCH_SIZE = 100
#: Batches in flight at once, so a page that needs several still costs one round trip of time.
CONCURRENCY = 6
#: Cached translations across all languages before the cache is dropped and rebuilt.
CACHE_LIMIT = 20_000

_cache: dict[tuple[str, str], str] = {}
_lock = asyncio.Lock()


def cache_size() -> int:
    return len(_cache)


def clear_cache() -> None:
    _cache.clear()


class TranslationService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def _language(self, requested: str) -> str:
        if requested in self._settings.supported_languages:
            return requested
        return self._settings.supported_languages[0] if self._settings.supported_languages else "en"

    async def translate(self, strings: list[str], requested_language: str) -> TranslateResponse:
        language = self._language(requested_language)

        # English is the source the interface is written in, so there is nothing to do.
        if language == "en" or not strings:
            return TranslateResponse(language=language, provider="none", translations={})

        unique = list(dict.fromkeys(s for s in strings if s.strip()))
        translations = {s: _cache[(language, s)] for s in unique if (language, s) in _cache}
        missing = [s for s in unique if s not in translations]
        if not missing:
            return TranslateResponse(
                language=language,
                provider="gemini" if translations else "none",
                translations=translations,
            )

        if not self._settings.gemini_enabled:
            log.info("No Gemini key: %d strings left untranslated for %s", len(missing), language)
            return TranslateResponse(language=language, provider="none", translations=translations)

        fresh = await self._translate_missing(missing, language)
        translations.update(fresh)
        return TranslateResponse(
            language=language,
            provider="gemini" if translations else "none",
            translations=translations,
        )

    async def _translate_missing(self, missing: list[str], language: str) -> dict[str, str]:
        from app.i18n.gemini_translator import GeminiTranslator

        translator = GeminiTranslator(self._settings)
        batches = [missing[i : i + BATCH_SIZE] for i in range(0, len(missing), BATCH_SIZE)]
        semaphore = asyncio.Semaphore(CONCURRENCY)

        async def run(batch: list[str]) -> dict[str, str]:
            async with semaphore:
                try:
                    out = await translator.translate(batch, language)
                except Exception as exc:  # one bad batch must not fail the rest
                    log.warning("Translation batch of %d failed for %s: %s", len(batch), language, exc)
                    return {}
            # An empty translation means the model dropped that entry; keep the source instead.
            return {src: text for src, text in zip(batch, out, strict=True) if text.strip()}

        results = await asyncio.gather(*(run(batch) for batch in batches))
        fresh: dict[str, str] = {}
        for result in results:
            fresh.update(result)

        if fresh:
            async with _lock:
                if len(_cache) + len(fresh) > CACHE_LIMIT:
                    log.info("Translation cache full (%d); clearing", len(_cache))
                    _cache.clear()
                for src, text in fresh.items():
                    _cache[(language, src)] = text
        return fresh

    def languages(self) -> list[dict[str, str]]:
        """The languages this service will translate into, for the app's language menu."""
        return [
            {"code": code, "name": LANGUAGE_NAMES.get(code, code)}
            for code in self._settings.supported_languages
        ]
