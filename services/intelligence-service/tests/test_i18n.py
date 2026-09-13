from __future__ import annotations

import asyncio

import pytest

from app.config import Settings
from app.errors import ApiError
from app.i18n import service as i18n_service
from app.i18n.gemini_translator import _parse
from app.i18n.service import TranslationService


def _settings(**overrides) -> Settings:
    base = dict(
        demo_mode=True,
        internal_service_token="token",
        ledger_service_url="http://localhost:8080",
        ollama_base_url="http://localhost:11434",
        ollama_model="",
        gemini_api_key="",
        gemini_model="gemini-3.6-flash",
        elevenlabs_api_key="",
        elevenlabs_agent_id="",
        max_upload_bytes=10_000_000,
        supported_languages=("en", "es", "fr"),
    )
    base.update(overrides)
    return Settings(**base)


@pytest.fixture(autouse=True)
def _clear_cache():
    i18n_service.clear_cache()
    yield
    i18n_service.clear_cache()


def test_english_is_never_sent_for_translation():
    service = TranslationService(_settings(gemini_api_key="key"))

    result = asyncio.run(service.translate(["Available cash"], "en"))

    assert result.provider == "none"
    assert result.translations == {}


def test_without_gemini_the_source_text_stands():
    service = TranslationService(_settings())

    result = asyncio.run(service.translate(["Available cash"], "es"))

    assert result.language == "es"
    assert result.provider == "none"
    assert result.translations == {}


def test_an_unsupported_language_falls_back_to_the_first_offered():
    service = TranslationService(_settings(supported_languages=("en", "es")))

    result = asyncio.run(service.translate(["Available cash"], "sv"))

    assert result.language == "en"


def test_translates_once_and_serves_the_rest_from_cache(monkeypatch):
    calls: list[list[str]] = []

    class FakeTranslator:
        def __init__(self, _settings) -> None:
            pass

        async def translate(self, strings: list[str], language: str) -> list[str]:
            calls.append(list(strings))
            return [f"{s} [{language}]" for s in strings]

    monkeypatch.setattr("app.i18n.gemini_translator.GeminiTranslator", FakeTranslator)
    service = TranslationService(_settings(gemini_api_key="key"))

    first = asyncio.run(service.translate(["Available cash", "Add task"], "es"))
    second = asyncio.run(service.translate(["Available cash", "Upcoming bills"], "es"))

    assert first.translations == {"Available cash": "Available cash [es]", "Add task": "Add task [es]"}
    assert second.translations["Available cash"] == "Available cash [es]"
    # The second call only asked about the string it had not seen before.
    assert calls == [["Available cash", "Add task"], ["Upcoming bills"]]


def test_the_same_string_is_translated_separately_per_language(monkeypatch):
    class FakeTranslator:
        def __init__(self, _settings) -> None:
            pass

        async def translate(self, strings: list[str], language: str) -> list[str]:
            return [f"{s} [{language}]" for s in strings]

    monkeypatch.setattr("app.i18n.gemini_translator.GeminiTranslator", FakeTranslator)
    service = TranslationService(_settings(gemini_api_key="key"))

    spanish = asyncio.run(service.translate(["Available cash"], "es"))
    french = asyncio.run(service.translate(["Available cash"], "fr"))

    assert spanish.translations["Available cash"] == "Available cash [es]"
    assert french.translations["Available cash"] == "Available cash [fr]"


def test_a_failed_batch_leaves_those_strings_untranslated(monkeypatch):
    class FailingTranslator:
        def __init__(self, _settings) -> None:
            pass

        async def translate(self, strings: list[str], language: str) -> list[str]:
            raise RuntimeError("Gemini is down")

    monkeypatch.setattr("app.i18n.gemini_translator.GeminiTranslator", FailingTranslator)
    service = TranslationService(_settings(gemini_api_key="key"))

    result = asyncio.run(service.translate(["Available cash"], "es"))

    # Degraded, not failed: the interface keeps its English rather than blanking out.
    assert result.provider == "none"
    assert result.translations == {}


def test_a_short_translation_list_is_refused():
    # A length mismatch would shift every label onto the wrong element.
    with pytest.raises(ApiError):
        _parse('{"translations": ["uno"]}', expected=2)


def test_malformed_json_is_refused():
    with pytest.raises(ApiError):
        _parse("not json", expected=1)


def test_parses_a_well_formed_list():
    assert _parse('{"translations": ["uno", "dos"]}', expected=2) == ["uno", "dos"]
