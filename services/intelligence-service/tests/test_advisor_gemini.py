from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from google.genai import errors

from app.advisor.gemini_adapter import GeminiAdvisor, build_contents
from app.advisor.schemas import AdvisorRequest
from app.errors import ApiError
from advisor_factories import demo_context, settings


def _settings():
    return settings(gemini_api_key="test-key")


def _request(language: str = "en", **extra) -> AdvisorRequest:
    return AdvisorRequest.model_validate(
        {
            "message": "What should I do first?",
            "language": language,
            "context": {
                "currentCash": 8000,
                "expectedInflow30d": 6500,
                "expectedOutflow30d": 13500,
                "firstGapDate": "2026-10-14T12:00:00Z",
                "firstGapAmount": 1200,
                "overdueReceivables": [
                    {"counterpartyLabel": "Client A", "amount": 4000, "daysOverdue": 12}
                ],
                "invoiceRisks": [],
                "openTodos": [],
            },
            **extra,
        }
    )


def _valid_reply() -> str:
    return json.dumps(
        {
            "answer": "You have a projected gap of $1,200 on 2026-10-14. Chase Client A first.",
            "summary": "Projected shortfall of $1,200 on 2026-10-14.",
            "risks": [
                {
                    "title": "Upcoming cash gap",
                    "severity": "HIGH",
                    "explanation": "Outflows exceed inflows before 2026-10-14.",
                }
            ],
            "proposedActions": [
                {
                    "title": "Follow up with Client A",
                    "rationale": "The $4,000 invoice is 12 days overdue.",
                    "priority": "HIGH",
                    "dueDate": None,
                    "estimatedImpact": 4000,
                }
            ],
        }
    )


def _final_prompt(generate: AsyncMock) -> str:
    contents = generate.await_args.kwargs["contents"]
    return contents[-1].parts[0].text


def test_advise_validates_a_schema_valid_gemini_reply():
    advisor = GeminiAdvisor(_settings())
    generate = AsyncMock(return_value=SimpleNamespace(text=_valid_reply()))
    advisor._client.aio.models.generate_content = generate

    response = asyncio.run(advisor.advise(_request()))

    assert response.proposed_actions[0].title == "Follow up with Client A"
    assert response.proposed_actions[0].priority == "HIGH"
    assert generate.await_args.kwargs["model"] == "gemini-3.6-flash"
    assert generate.await_args.kwargs["config"].response_mime_type == "application/json"
    assert generate.await_args.kwargs["config"].response_json_schema["required"] == ["answer", "summary", "risks", "proposedActions"]
    assert "Never invent a transaction" in generate.await_args.kwargs["config"].system_instruction


def test_advise_never_sends_anything_beyond_the_allowlisted_context():
    advisor = GeminiAdvisor(_settings())
    generate = AsyncMock(return_value=SimpleNamespace(text=_valid_reply()))
    advisor._client.aio.models.generate_content = generate
    context = demo_context()
    context["documentText"] = "RAW OCR TEXT"
    context["accountNumber"] = "123456789"
    request = AdvisorRequest.model_validate({"message": "What should I do first?", "language": "en", "context": context})

    asyncio.run(advisor.advise(request))

    sent_prompt = _final_prompt(generate)
    assert "documentText" not in sent_prompt and "RAW OCR TEXT" not in sent_prompt
    assert "accountNumber" not in sent_prompt and "123456789" not in sent_prompt
    assert "Client A" in sent_prompt
    assert "Today's date (from the ledger): 2026-09-12" in sent_prompt


def test_conversation_history_becomes_alternating_user_and_model_turns():
    request = _request(history=[{"role": "user", "content": "How am I doing?"}, {"role": "advisor", "content": "You hold $8,000."}])

    contents = build_contents(request)

    assert [c.role for c in contents] == ["user", "model", "user"]
    assert contents[0].parts[0].text == "How am I doing?"
    assert contents[1].parts[0].text == "You hold $8,000."
    assert "User question: What should I do first?" in contents[2].parts[0].text
    # The context travels with the current question only, never inside history turns.
    assert "currentCash" not in contents[0].parts[0].text
    assert "currentCash" in contents[2].parts[0].text


def test_voice_channel_adds_a_spoken_delivery_note_only():
    text_prompt = build_contents(_request())[-1].parts[0].text
    voice_prompt = build_contents(_request(channel="voice"))[-1].parts[0].text

    assert "read aloud" not in text_prompt
    assert "read aloud" in voice_prompt
    assert "Allowlisted financial context" in voice_prompt


def test_advise_rejects_malformed_output_instead_of_repairing_it():
    advisor = GeminiAdvisor(_settings())
    generate = AsyncMock(return_value=SimpleNamespace(text="not json"))
    advisor._client.aio.models.generate_content = generate

    with pytest.raises(ApiError) as excinfo:
        asyncio.run(advisor.advise(_request()))
    assert excinfo.value.code == "ADVISOR_UNAVAILABLE"
    assert excinfo.value.retryable is False


@pytest.mark.parametrize(
    "payload",
    [
        {"answer": "only an answer"},
        {"answer": "a", "summary": "", "risks": [], "proposedActions": []},
        {"answer": "a", "summary": "s", "risks": [{"title": "t", "severity": "SEVERE", "explanation": "e"}], "proposedActions": []},
        {"answer": "a", "summary": "s", "risks": [], "proposedActions": [{"title": "t", "rationale": "r", "priority": "HIGH", "dueDate": "soon"}]},
        [],
    ],
)
def test_advise_rejects_incomplete_or_ill_typed_output(payload):
    advisor = GeminiAdvisor(_settings())
    advisor._client.aio.models.generate_content = AsyncMock(return_value=SimpleNamespace(text=json.dumps(payload)))

    with pytest.raises(ApiError) as excinfo:
        asyncio.run(advisor.advise(_request()))
    assert excinfo.value.code == "ADVISOR_UNAVAILABLE"


def test_advise_treats_an_empty_reply_as_unavailable():
    advisor = GeminiAdvisor(_settings())
    advisor._client.aio.models.generate_content = AsyncMock(return_value=SimpleNamespace(text=""))

    with pytest.raises(ApiError) as excinfo:
        asyncio.run(advisor.advise(_request()))
    assert excinfo.value.code == "ADVISOR_UNAVAILABLE"
    assert excinfo.value.retryable is True


def test_advise_surfaces_transport_failures_as_advisor_unavailable():
    advisor = GeminiAdvisor(_settings())

    async def _boom(*_args, **_kwargs):
        raise errors.ClientError(code=400, response_json={"error": {"message": "bad request"}})

    advisor._client.aio.models.generate_content = _boom

    with pytest.raises(ApiError) as excinfo:
        asyncio.run(advisor.advise(_request()))
    assert excinfo.value.code == "ADVISOR_UNAVAILABLE"
    assert excinfo.value.retryable is True


def test_advise_surfaces_network_failures_as_advisor_unavailable():
    advisor = GeminiAdvisor(_settings())

    async def _boom(*_args, **_kwargs):
        raise ConnectionError("connection refused")

    advisor._client.aio.models.generate_content = _boom

    with pytest.raises(ApiError) as excinfo:
        asyncio.run(advisor.advise(_request()))
    assert excinfo.value.code == "ADVISOR_UNAVAILABLE"
    assert excinfo.value.retryable is True


def test_language_and_channel_are_passed_through_verbatim_by_the_adapter():
    # Normalisation lives in AdvisorService; the adapter sends what it is given.
    prompt = build_contents(_request(language="es"))[-1].parts[0].text
    assert "Requested reply language (BCP-47 code): es" in prompt
