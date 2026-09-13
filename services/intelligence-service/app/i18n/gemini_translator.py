"""Gemini interface translation.

Translates batches of interface strings into one target language. Two things make this
different from a general-purpose translator: product names are preserved verbatim, and the
model is asked for the plainest wording that still says the same thing, because the people this
feature exists for are often reading financial terms for the first time in any language.

Needs the ``ai`` extra (``google-genai``).
"""

from __future__ import annotations

import logging

from google import genai
from google.genai import types

from app.config import Settings
from app.errors import ADVISOR_UNAVAILABLE, ApiError
from app.i18n.schemas import LANGUAGE_NAMES, PRESERVED_TERMS

log = logging.getLogger(__name__)

_SCHEMA = {
    "type": "object",
    "properties": {
        "translations": {
            "type": "array",
            "description": "One translation per input string, in the same order.",
            "items": {"type": "string"},
        }
    },
    "required": ["translations"],
    "additionalProperties": False,
}


def system_prompt(language_name: str) -> str:
    return (
        f"You translate the interface of a small-business cash-flow app into {language_name}.\n"
        "\n"
        "Rules:\n"
        f"1. Return exactly one translation per input string, in the same order. Never merge, "
        "split, reorder or drop an entry.\n"
        "2. Translate the meaning, not the words. Prefer the plainest wording a small-business "
        "owner with no financial training would understand, while keeping the meaning exact. "
        "Where a financial term has a common everyday equivalent, use the everyday one.\n"
        "3. Keep these names exactly as written, untranslated: "
        f"{', '.join(PRESERVED_TERMS)}.\n"
        "4. Keep numbers, currency symbols, percentages, dates and amounts exactly as they "
        "appear. Do not convert currencies or reformat figures.\n"
        "5. Keep the register of the original: a button label stays a short button label, a "
        "heading stays a heading. Do not add explanations, punctuation or quotation marks that "
        "the original does not have.\n"
        "6. If a string is a proper noun, a code, or already correct in the target language, "
        "return it unchanged.\n"
    )


class GeminiTranslator:
    provider = "gemini"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = genai.Client(api_key=settings.gemini_api_key)

    async def translate(self, strings: list[str], language: str) -> list[str]:
        """Returns a translation for each input string, in order.

        Raises ``ApiError`` when Gemini cannot be reached or answers with the wrong shape; the
        caller falls back to the source text so the interface stays readable either way.
        """
        language_name = LANGUAGE_NAMES.get(language, language)
        numbered = "\n".join(f"{i + 1}. {text}" for i, text in enumerate(strings))
        try:
            response = await self._client.aio.models.generate_content(
                model=self._settings.gemini_model,
                contents=[
                    types.Content(
                        role="user",
                        parts=[
                            types.Part.from_text(
                                text=f"Translate these {len(strings)} interface strings into "
                                f"{language_name}:\n\n{numbered}"
                            )
                        ],
                    )
                ],
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt(language_name),
                    response_mime_type="application/json",
                    response_json_schema=_SCHEMA,
                    temperature=0.0,
                    # Interface translation is recall, not reasoning, and the model is noticeably
                    # slower when it deliberates: measured 5.9s against 2.1s for the same batch.
                    # Someone is watching the page while this runs, so latency is the feature.
                    thinking_config=types.ThinkingConfig(thinking_level="low"),
                ),
            )
        except genai.errors.APIError as exc:
            log.warning("Gemini translation failed: %s", exc)
            raise ApiError(ADVISOR_UNAVAILABLE, "Translation is temporarily unavailable.", retryable=True) from exc
        except Exception as exc:  # network errors, timeouts, SDK transport failures
            log.warning("Gemini translation could not be completed: %s", exc)
            raise ApiError(ADVISOR_UNAVAILABLE, "Translation could not be reached.", retryable=True) from exc

        return _parse(response.text, len(strings))


def _parse(text: str | None, expected: int) -> list[str]:
    import json

    if not text:
        raise ApiError(ADVISOR_UNAVAILABLE, "Translation returned an empty response.", retryable=True)
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ApiError(ADVISOR_UNAVAILABLE, "Translation returned malformed JSON.", retryable=True) from exc

    items = payload.get("translations") if isinstance(payload, dict) else None
    if not isinstance(items, list) or len(items) != expected:
        # A length mismatch would silently shift every label onto the wrong element.
        raise ApiError(
            ADVISOR_UNAVAILABLE,
            "Translation returned a different number of strings than were sent.",
            retryable=True,
        )
    return [item if isinstance(item, str) else "" for item in items]
