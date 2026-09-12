"""Prefer embedded PDF text; scanned pages use the OCR fallback."""

from __future__ import annotations

from pathlib import Path

MIN_USEFUL_CHARACTERS = 40

SUPPORTED_CONTENT_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
}


def pymupdf_available() -> bool:
    try:
        import fitz  # noqa: F401  (PyMuPDF)
    except ImportError:
        return False
    return True


def extract_text(path: Path) -> str:
    """Returns the document's embedded text, or an empty string when there is none to speak of."""
    if not pymupdf_available():
        return ""
    import fitz

    with fitz.open(path) as document:
        text = "\n".join(page.get_text() for page in document)
    return text if len(text.strip()) >= MIN_USEFUL_CHARACTERS else ""
