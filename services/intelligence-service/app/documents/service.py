"""Private document handling.

Privacy rules enforced here:
  * raw bytes live in a temp directory and are deleted in a ``finally`` block;
  * document text stays in this process and is never returned, logged or forwarded;
  * only the validated, sanitized extraction leaves the service.
"""

from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path

from app.config import Settings
from app.documents import ocr, parser
from app.documents.privacy import payment_fingerprint
from app.documents.schemas import ExtractedInvoice, ExtractionResponse
from app.errors import DOCUMENT_EXTRACTION_FAILED, DOCUMENT_UNSUPPORTED, ApiError
from app.local_llm.base import LocalExtractor
from app.local_llm.mock_adapter import MockLocalExtractor
from app.local_llm.ollama_adapter import LocalModelUnavailable, OllamaLocalExtractor

log = logging.getLogger(__name__)


def build_extractor(settings: Settings) -> LocalExtractor:
    if settings.ollama_enabled:
        return OllamaLocalExtractor(settings)
    log.info("Using MockLocalExtractor (OLLAMA_MODEL is not set)")
    return MockLocalExtractor()


class DocumentService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._extractor = build_extractor(settings)

    async def extract(self, filename: str, content_type: str | None, content: bytes) -> ExtractionResponse:
        if content_type and content_type not in parser.SUPPORTED_CONTENT_TYPES:
            raise ApiError(
                DOCUMENT_UNSUPPORTED,
                f"{content_type} is not a supported document type.",
            )
        if len(content) > self._settings.max_upload_bytes:
            raise ApiError(DOCUMENT_UNSUPPORTED, "The document is larger than the upload limit.")
        if not content:
            raise ApiError(DOCUMENT_UNSUPPORTED, "The document is empty.")

        warnings: list[str] = []
        with tempfile.TemporaryDirectory(prefix="cfc-doc-") as workdir:
            temp_path = Path(workdir) / "document"
            try:
                temp_path.write_bytes(content)
                if isinstance(self._extractor, MockLocalExtractor):
                    warnings.append("Demo extraction: these are sample invoice values, not values read from your document.")
                text = await asyncio.to_thread(parser.extract_text, temp_path)
                if not text:
                    text = await asyncio.to_thread(ocr.extract_text, temp_path)
                if not text and not isinstance(self._extractor, MockLocalExtractor):
                    raise ApiError(DOCUMENT_EXTRACTION_FAILED,
                                   "No readable text was found. Install Tesseract for scanned documents.")
                used_mock = isinstance(self._extractor, MockLocalExtractor)
                try:
                    extraction = await self._extractor.extract_invoice(text)
                except LocalModelUnavailable:
                    if not self._settings.demo_mode:
                        raise
                    extraction = await MockLocalExtractor().extract_invoice("")
                    used_mock = True
                    warnings.append("Ollama is unavailable. Demo extraction used sample invoice values.")
                if not used_mock:
                    extraction = extraction.model_copy(update={
                        "payment_destination_fingerprint": payment_fingerprint(text)
                    })
            except ApiError:
                raise
            except Exception as exc:  # noqa: BLE001 - never leak document contents in the message
                log.warning("Local document extraction failed")
                raise ApiError(
                    DOCUMENT_EXTRACTION_FAILED,
                    "The document could not be interpreted.",
                    retryable=True,
                ) from exc
            finally:
                # The TemporaryDirectory removes the tree, but the raw bytes are unlinked eagerly.
                temp_path.unlink(missing_ok=True)

        return ExtractionResponse(extraction=self._sanitize(extraction), warnings=warnings)

    def _sanitize(self, extraction: ExtractedInvoice) -> ExtractedInvoice:
        """Re-validating the model's own output keeps unvalidated text off the wire."""
        return ExtractedInvoice.model_validate(extraction.model_dump())
