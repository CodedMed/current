"""The shared advisor entry point: normalisation, meta labelling, and the Gemini fallback policy."""

from __future__ import annotations

import asyncio

import pytest

from app.advisor.mock_adapter import MockAdvisor
from app.advisor.schemas import AdvisorResponse
from app.advisor.service import MAX_HISTORY_TURNS, AdvisorService
from app.errors import ADVISOR_UNAVAILABLE, INVALID_FINANCIAL_DATA, ApiError
from advisor_factories import request, settings


class FailingGemini:
    provider = "gemini"

    def __init__(self, error: ApiError) -> None:
        self.error = error
        self.calls = 0

    async def advise(self, _request):
        self.calls += 1
        raise self.error


class RecordingAdvisor:
    provider = "gemini"

    def __init__(self) -> None:
        self.seen = []

    async def advise(self, req):
        self.seen.append(req)
        return AdvisorResponse(answer="ok", summary="ok", risks=[], proposed_actions=[])


def test_mock_answers_are_labelled_as_mock():
    service = AdvisorService(settings())

    reply = asyncio.run(service.chat(request("How much cash do I have?")))

    assert reply.meta is not None
    assert reply.meta.provider == "mock"
    assert reply.meta.model is None
    assert reply.meta.fallback_reason is None
    assert reply.meta.language == "en"
    assert reply.meta.channel == "text"


def test_gemini_failure_falls_back_to_the_demo_advisor_in_demo_mode():
    gemini = FailingGemini(ApiError(ADVISOR_UNAVAILABLE, "The Gemini advisor is temporarily unavailable.", retryable=True))
    service = AdvisorService(settings(demo_mode=True, gemini_api_key="key"), advisor=gemini)

    reply = asyncio.run(service.chat(request("What should I do first?")))

    assert gemini.calls == 1
    assert reply.meta.provider == "mock"
    assert reply.meta.fallback_reason == "The Gemini advisor is temporarily unavailable."
    # Still a grounded answer, not a generic apology.
    assert reply.proposed_actions[0].title == "Follow up with Client A"


def test_gemini_failure_is_surfaced_outside_demo_mode():
    gemini = FailingGemini(ApiError(ADVISOR_UNAVAILABLE, "down", retryable=True))
    service = AdvisorService(settings(demo_mode=False, gemini_api_key="key"), advisor=gemini)

    with pytest.raises(ApiError) as excinfo:
        asyncio.run(service.chat(request("What should I do first?")))
    assert excinfo.value.code == ADVISOR_UNAVAILABLE


def test_only_advisor_unavailable_triggers_the_fallback():
    gemini = FailingGemini(ApiError(INVALID_FINANCIAL_DATA, "bad context"))
    service = AdvisorService(settings(demo_mode=True, gemini_api_key="key"), advisor=gemini)

    with pytest.raises(ApiError) as excinfo:
        asyncio.run(service.chat(request("hi")))
    assert excinfo.value.code == INVALID_FINANCIAL_DATA


def test_language_falls_back_and_history_is_trimmed_before_the_adapter_sees_it():
    advisor = RecordingAdvisor()
    service = AdvisorService(settings(gemini_api_key="key"), advisor=advisor)
    history = [{"role": "user" if i % 2 == 0 else "advisor", "content": f"turn {i}"} for i in range(30)]

    reply = asyncio.run(service.chat(request("next?", language="fr", history=history)))

    seen = advisor.seen[0]
    assert seen.language == "en"
    assert len(seen.history) == MAX_HISTORY_TURNS
    assert seen.history[-1].content == "turn 29"
    assert reply.meta.provider == "gemini"
    assert reply.meta.model == "gemini-3.6-flash"


def test_lists_are_trimmed_rather_than_rejected():
    class Verbose:
        provider = "gemini"

        async def advise(self, _req):
            many = [{"title": f"r{i}", "severity": "LOW", "explanation": "x"} for i in range(12)]
            return AdvisorResponse.model_validate({"answer": "a", "summary": "s", "risks": many, "proposedActions": []})

    service = AdvisorService(settings(gemini_api_key="key"), advisor=Verbose())

    reply = asyncio.run(service.chat(request("hi")))

    assert len(reply.risks) == 6


def test_the_mock_never_falls_back_onto_itself():
    service = AdvisorService(settings(), advisor=MockAdvisor())
    assert service._can_fall_back(ApiError(ADVISOR_UNAVAILABLE, "x")) is False
