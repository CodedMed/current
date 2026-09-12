"""Local extraction port.

Document text is private: it is read, structured and discarded on this machine. It must never be
forwarded to Gemini, ElevenLabs, or any other hosted service.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from app.documents.schemas import ExtractedInvoice

_PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "invoice_extractor.txt"


class LocalExtractor(Protocol):
    async def extract_invoice(self, text: str) -> ExtractedInvoice: ...


def extractor_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")
