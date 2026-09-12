import asyncio
import json
from dataclasses import replace
from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError

from app.config import get_settings
from app.documents import ocr, parser
from app.documents.privacy import payment_fingerprint
from app.documents.schemas import ExtractedInvoice
from app.documents.service import DocumentService
from app.errors import ApiError
from app.local_llm.ollama_adapter import OllamaLocalExtractor

SAMPLE = Path(__file__).resolve().parents[3] / "samples/invoices/suspicious_vendor_invoice.pdf"
VALID = {"vendorKey": "cloud_provider", "amount": 1300, "category": "cloud_services", "confidence": 0.96}


def run(coroutine):
    return asyncio.run(coroutine)


def test_embedded_pdf_is_preferred_and_raw_file_deleted(monkeypatch):
    paths = []
    original = parser.extract_text
    def parse(path):
        paths.append(path)
        return original(path)
    monkeypatch.setattr(parser, "extract_text", parse)
    monkeypatch.setattr(ocr, "extract_text", lambda path: pytest.fail("OCR must not run for embedded text"))
    result = run(DocumentService(replace(get_settings(), ollama_model="")).extract("../../invoice.pdf", "application/pdf", SAMPLE.read_bytes()))
    assert result.extraction.amount == 1300
    assert "Demo extraction" in result.warnings[0]
    assert paths and all(not p.exists() and not p.parent.exists() for p in paths)


def test_cleanup_and_no_private_exception_logging(monkeypatch, caplog):
    paths = []
    def fail(path):
        paths.append(path)
        raise ValueError("PRIVATE ACCOUNT 123456789")
    monkeypatch.setattr(parser, "extract_text", fail)
    with pytest.raises(ApiError) as exc:
        run(DocumentService(get_settings()).extract("invoice.pdf", "application/pdf", SAMPLE.read_bytes()))
    assert "PRIVATE" not in str(exc.value) + caplog.text
    assert all(not p.exists() and not p.parent.exists() for p in paths)


@pytest.mark.parametrize("content,mime", [(b"", "application/pdf"), (b"x", "text/plain"), (b"x" * 11, "application/pdf")])
def test_invalid_uploads(content, mime):
    with pytest.raises(ApiError):
        run(DocumentService(replace(get_settings(), max_upload_bytes=10)).extract("x", mime, content))


def test_unreadable_live_document_fails_without_calling_model(monkeypatch):
    monkeypatch.setattr(parser, "extract_text", lambda p: "")
    monkeypatch.setattr(ocr, "tesseract_available", lambda: False)
    with pytest.raises(ApiError, match="No readable text"):
        run(DocumentService(replace(get_settings(), ollama_model="local")).extract("x.pdf", "application/pdf", SAMPLE.read_bytes()))


def ollama_reply(monkeypatch, content, status=200):
    original = httpx.AsyncClient
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(status, json={"message": {"content": content}})
    def client(**kwargs):
        assert kwargs["trust_env"] is False and kwargs["follow_redirects"] is False
        return original(transport=httpx.MockTransport(handler), **kwargs)
    monkeypatch.setattr(httpx, "AsyncClient", client)
    return requests


def test_ollama_uses_local_chat_and_validates(monkeypatch):
    requests = ollama_reply(monkeypatch, json.dumps(VALID))
    result = run(OllamaLocalExtractor(replace(get_settings(), ollama_model="llama3.2")).extract_invoice("private invoice"))
    body = json.loads(requests[0].content)
    assert requests[0].url == "http://localhost:11434/api/chat"
    assert body["format"] == "json" and body["stream"] is False
    assert body["messages"][0]["role"] == "system"
    assert "untrusted" in body["messages"][0]["content"]
    assert body["messages"][1]["content"] == "private invoice"
    assert result.amount == 1300


@pytest.mark.parametrize("content", ["not JSON", "{}", json.dumps({**VALID, "amount": -1}), json.dumps({**VALID, "accountNumber": "123456789"})])
def test_invalid_model_output_is_rejected_without_leaking(monkeypatch, content):
    ollama_reply(monkeypatch, content)
    with pytest.raises(ApiError) as exc:
        run(OllamaLocalExtractor(replace(get_settings(), ollama_model="local")).extract_invoice("private"))
    assert "123456789" not in str(exc.value)


@pytest.mark.parametrize("url", ["https://example.com", "http://localhost@example.com", "http://localhost/?redirect=remote"])
def test_remote_ollama_is_rejected(url):
    with pytest.raises(ApiError, match="local server"):
        run(OllamaLocalExtractor(replace(get_settings(), ollama_model="local", ollama_base_url=url)).extract_invoice("private"))


def test_fingerprint_is_local_stable_and_not_raw():
    a = payment_fingerprint("Account: 1234-5678\nRouting: 999999999")
    assert a == payment_fingerprint("Routing: 999999999\nAccount: 12345678")
    assert a != payment_fingerprint("Account: 12345679\nRouting: 999999999")
    assert a.startswith("sha256:") and len(a) == 71 and "12345678" not in a
    assert payment_fingerprint("No payment instructions") is None


@pytest.mark.parametrize("field,value", [("amount", "NaN"), ("amount", "1.001"), ("paymentDestinationFingerprint", "123456789"), ("vendorKey", "account 12345678"), ("vendorDisplayName", "Call 123456789")])
def test_output_rejects_invalid_money_and_identifiers(field, value):
    with pytest.raises(ValidationError):
        ExtractedInvoice.model_validate({**VALID, field: value})


@pytest.mark.parametrize("fail", [False, True])
def test_ocr_renders_all_pages_and_removes_images(monkeypatch, tmp_path, fail):
    fitz = pytest.importorskip("fitz")
    pytesseract = pytest.importorskip("pytesseract")
    path = tmp_path / "scanned.pdf"
    with fitz.open() as doc:
        doc.new_page()
        doc.new_page()
        doc.save(path)
    images = []
    monkeypatch.setattr(ocr, "tesseract_available", lambda: True)
    def read(image, **kwargs):
        images.append(Path(image.filename))
        assert images[-1].exists()
        if fail:
            raise RuntimeError("OCR failure")
        return "Invoice text"
    monkeypatch.setattr(pytesseract, "image_to_string", read)
    if fail:
        with pytest.raises(RuntimeError):
            ocr.extract_text(path)
    else:
        assert ocr.extract_text(path) == "Invoice text\nInvoice text"
        assert len(images) == 2
    assert all(not p.exists() and not p.parent.exists() for p in images)


@pytest.mark.parametrize("demo_mode", [False, True])
def test_unavailable_ollama_falls_back_only_in_demo(monkeypatch, demo_mode):
    from app.local_llm.ollama_adapter import LocalModelUnavailable
    async def unavailable(self, text):
        raise LocalModelUnavailable()
    monkeypatch.setattr(OllamaLocalExtractor, "extract_invoice", unavailable)
    service = DocumentService(replace(get_settings(), ollama_model="local", demo_mode=demo_mode))
    if demo_mode:
        result = run(service.extract("invoice.pdf", "application/pdf", SAMPLE.read_bytes()))
        assert result.extraction.amount == 1300
        assert any("Ollama is unavailable" in warning for warning in result.warnings)
    else:
        with pytest.raises(LocalModelUnavailable):
            run(service.extract("invoice.pdf", "application/pdf", SAMPLE.read_bytes()))
