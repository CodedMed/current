"""Schema-validated extraction through an on-machine Ollama server."""
from __future__ import annotations

import json
from urllib.parse import urlsplit

import httpx
from pydantic import ValidationError

from app.config import Settings
from app.documents.schemas import ExtractedInvoice
from app.errors import DOCUMENT_EXTRACTION_FAILED, ApiError
from app.local_llm.base import extractor_prompt


class LocalModelUnavailable(ApiError):
    def __init__(self):
        super().__init__(DOCUMENT_EXTRACTION_FAILED, "The local model is unavailable.", retryable=True)


class OllamaLocalExtractor:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def extract_invoice(self, text: str) -> ExtractedInvoice:
        url = urlsplit(self._settings.ollama_base_url)
        if (url.scheme not in {"http", "https"}
                or url.hostname not in {"localhost", "127.0.0.1", "::1", "host.docker.internal"}
                or url.username or url.password or url.query or url.fragment):
            raise ApiError(DOCUMENT_EXTRACTION_FAILED, "Ollama must use a local server address.")
        if not text.strip():
            raise ApiError(DOCUMENT_EXTRACTION_FAILED, "No readable invoice text was found.")
        try:
            # Disable environment proxies and redirects: private text must stay on this machine.
            async with httpx.AsyncClient(timeout=120, trust_env=False, follow_redirects=False) as client:
                response = await client.post(
                    self._settings.ollama_base_url.rstrip("/") + "/api/chat",
                    json={
                        "model": self._settings.ollama_model,
                        "format": "json",
                        "stream": False,
                        "options": {"temperature": 0},
                        "messages": [
                            {"role": "system", "content": extractor_prompt() +
                             "\nRequired JSON schema:\n" + json.dumps(ExtractedInvoice.model_json_schema(by_alias=True))},
                            {"role": "user", "content": text},
                        ],
                    },
                )
                response.raise_for_status()
                return ExtractedInvoice.model_validate_json(response.json()["message"]["content"])
        except (httpx.ConnectError, httpx.TimeoutException):
            raise LocalModelUnavailable() from None
        except (httpx.HTTPError, ValidationError, ValueError, KeyError, TypeError):
            # Never include model output, document text, or upstream exception details.
            raise ApiError(DOCUMENT_EXTRACTION_FAILED,
                           "The local model could not produce a valid invoice. Check Ollama and try again.",
                           retryable=True) from None
