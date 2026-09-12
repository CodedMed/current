from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from elevenlabs.core.api_error import ApiError as ElevenLabsApiError

from app.advisor.service import AdvisorService
from app.config import Settings
from app.errors import ApiError
from app.voice.elevenlabs_adapter import ElevenLabsVoiceAdapter
from app.voice.service import VOICE_CLIENT_TOOL, VoiceService


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
        supported_languages=("en", "es"),
    )
    base.update(overrides)
    return Settings(**base)


def test_voice_service_falls_back_to_text_without_credentials():
    service = VoiceService(_settings(), AdvisorService(_settings()))

    session = service.session("es")

    assert session == {
        "available": False,
        "mode": "text",
        "language": "es",
        "supportedLanguages": ["en", "es"],
        "reason": "ELEVENLABS_API_KEY is not configured; the advisor stays on text.",
    }


def test_voice_service_mints_a_real_session_when_credentials_are_present(monkeypatch):
    settings = _settings(elevenlabs_api_key="key", elevenlabs_agent_id="agent-1")
    service = VoiceService(settings, AdvisorService(settings))

    adapter_instance = MagicMock()
    adapter_instance.create_session.return_value = {
        "available": True,
        "mode": "voice",
        "language": "en",
        "signedUrl": "wss://api.elevenlabs.io/session/abc",
        "agentId": "agent-1",
    }
    monkeypatch.setattr(
        "app.voice.elevenlabs_adapter.ElevenLabsVoiceAdapter",
        lambda _settings: adapter_instance,
    )

    session = service.session("en")

    assert session["available"] is True
    assert session["signedUrl"] == "wss://api.elevenlabs.io/session/abc"


def test_elevenlabs_adapter_mints_a_signed_url():
    settings = _settings(elevenlabs_api_key="key", elevenlabs_agent_id="agent-1")
    adapter = ElevenLabsVoiceAdapter(settings)
    adapter._client.conversational_ai.conversations.get_signed_url = MagicMock(
        return_value=SimpleNamespace(signed_url="wss://api.elevenlabs.io/session/abc")
    )

    session = adapter.create_session("en")

    assert session == {
        "available": True,
        "mode": "voice",
        "language": "en",
        "signedUrl": "wss://api.elevenlabs.io/session/abc",
        "agentId": "agent-1",
    }


def test_elevenlabs_adapter_surfaces_provider_failures_as_voice_unavailable():
    settings = _settings(elevenlabs_api_key="key", elevenlabs_agent_id="agent-1")
    adapter = ElevenLabsVoiceAdapter(settings)

    def _boom(**_kwargs):
        raise ElevenLabsApiError(status_code=401, body={"detail": "bad key"})

    adapter._client.conversational_ai.conversations.get_signed_url = _boom

    with pytest.raises(ApiError) as excinfo:
        adapter.create_session("en")
    assert excinfo.value.code == "VOICE_UNAVAILABLE"
    assert excinfo.value.retryable is True


def test_voice_is_unavailable_without_an_agent_id_even_with_a_key():
    settings = _settings(elevenlabs_api_key="key", elevenlabs_agent_id="")
    service = VoiceService(settings, AdvisorService(settings))

    session = service.session("en")

    assert session["available"] is False
    assert session["reason"] == "ELEVENLABS_AGENT_ID is not configured; the advisor stays on text."


def test_available_sessions_tell_the_browser_which_client_tool_to_register(monkeypatch):
    settings = _settings(elevenlabs_api_key="key", elevenlabs_agent_id="agent-1")
    service = VoiceService(settings, AdvisorService(settings))
    adapter_instance = MagicMock()
    adapter_instance.create_session.return_value = {"available": True, "mode": "voice", "language": "es", "signedUrl": "wss://x", "agentId": "agent-1"}
    monkeypatch.setattr("app.voice.elevenlabs_adapter.ElevenLabsVoiceAdapter", lambda _settings: adapter_instance)

    session = service.session("es")

    assert session["clientToolName"] == VOICE_CLIENT_TOOL == "ask_cash_flow_advisor"
    assert session["supportedLanguages"] == ["en", "es"]
    # The API key never appears in what the browser receives.
    assert "key" not in str(session.values())


def test_a_spoken_turn_runs_the_shared_advisor_with_the_voice_delivery_hint():
    import asyncio

    from app.advisor.schemas import AdvisorRequest

    settings = _settings()
    service = VoiceService(settings, AdvisorService(settings))
    request = AdvisorRequest.model_validate(
        {
            "message": "What should I do first?",
            "language": "en",
            "context": {
                "currentCash": 8000,
                "expectedInflow30d": 6500,
                "expectedOutflow30d": 13500,
                "firstGapDate": "2026-10-14T12:00:00Z",
                "firstGapAmount": 1200,
                "overdueReceivables": [{"counterpartyLabel": "Client A", "amount": 4000, "daysOverdue": 12}],
            },
        }
    )

    reply = asyncio.run(service.message(request))

    assert reply.meta.channel == "voice"
    assert reply.meta.provider == "mock"
    assert "\n" not in reply.answer
    assert reply.proposed_actions[0].title == "Follow up with Client A"
