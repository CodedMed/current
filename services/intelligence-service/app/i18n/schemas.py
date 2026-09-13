"""Request and response shapes for interface translation."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

#: The name each language is given to the model. Kept beside the codes the web app offers.
LANGUAGE_NAMES: dict[str, str] = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "nl": "Dutch",
    "pl": "Polish",
    "hi": "Hindi",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Simplified Chinese",
    "ar": "Arabic",
}

#: Never translated: product and vendor names a reader recognises in any language.
PRESERVED_TERMS = (
    "current.surf",
    "Cash Flow Copilot",
    "Persona",
    "Gemini",
    "Nessie",
    "ElevenLabs",
    "Capital One",
    "Google",
    "Tiger Data",
    "TimescaleDB",
    "Ollama",
)


class TranslateRequest(BaseModel):
    language: str
    #: Bounded so one interface pass cannot become an unbounded model call.
    strings: list[str] = Field(default_factory=list, max_length=200)


class TranslateResponse(BaseModel):
    language: str
    #: ``none`` means the source text stands: no Gemini key, so nothing was translated.
    provider: Literal["gemini", "none"]
    translations: dict[str, str]
