"""Advisor entry point shared by the text and the voice surfaces.

The voice layer must reuse this exact reasoning path — speech is transport, not a second brain.
This module also owns the fallback policy: when Gemini cannot answer, demo mode degrades to the
deterministic mock (labelled as such in ``meta``) so the product keeps working; outside demo mode
the failure is surfaced so nobody mistakes a canned answer for the hosted model.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Protocol

from app.advisor.mock_adapter import MockAdvisor
from app.advisor.schemas import AdvisorMeta, AdvisorRequest, AdvisorResponse
from app.config import Settings
from app.errors import ADVISOR_UNAVAILABLE, ApiError

log = logging.getLogger(__name__)

_SYSTEM_PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "cfo_system.txt"

# Continuity, not memory: only the last few turns travel with a question.
MAX_HISTORY_TURNS = 10
# The UI renders a handful of cards; more than this is noise, so long lists are trimmed, not rejected.
MAX_LIST_ITEMS = 6


class Advisor(Protocol):
    provider: str

    async def advise(self, request: AdvisorRequest) -> AdvisorResponse: ...


def system_prompt() -> str:
    return _SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")


def build_advisor(settings: Settings) -> Advisor:
    if settings.gemini_enabled:
        try:
            from app.advisor.gemini_adapter import GeminiAdvisor
        except ImportError as exc:  # the ``ai`` extra is not installed
            if not settings.demo_mode:
                raise RuntimeError(
                    "GEMINI_API_KEY is set but the google-genai package is not installed; "
                    "run `pip install -e '.[ai]'`."
                ) from exc
            log.warning("google-genai is not installed; using MockAdvisor in demo mode (%s)", exc)
            return MockAdvisor()
        return GeminiAdvisor(settings)
    log.info("Using MockAdvisor (GEMINI_API_KEY is not set)")
    return MockAdvisor()


def normalize_request(request: AdvisorRequest, settings: Settings) -> AdvisorRequest:
    """Language falls back to the first supported code; history keeps only the most recent turns."""
    language = request.language if request.language in settings.supported_languages else settings.supported_languages[0]
    history = request.history[-MAX_HISTORY_TURNS:] if len(request.history) > MAX_HISTORY_TURNS else request.history
    return request.model_copy(update={"language": language, "history": history})


class AdvisorService:
    def __init__(self, settings: Settings, advisor: Advisor | None = None) -> None:
        self._settings = settings
        self._advisor: Advisor = advisor if advisor is not None else build_advisor(settings)
        self._fallback = MockAdvisor()

    async def chat(self, request: AdvisorRequest) -> AdvisorResponse:
        request = normalize_request(request, self._settings)
        try:
            response = await self._advisor.advise(request)
        except ApiError as exc:
            if not self._can_fall_back(exc):
                raise
            log.warning("Advisor '%s' unavailable (%s); answering with the demo advisor", self._advisor.provider, exc.message)
            response = await self._fallback.advise(request)
            return self._finalize(response, request, provider="mock", model=None, fallback_reason=exc.message)
        model = self._settings.gemini_model if self._advisor.provider == "gemini" else None
        return self._finalize(response, request, provider=self._advisor.provider, model=model, fallback_reason=None)

    def _can_fall_back(self, exc: ApiError) -> bool:
        return (
            exc.code == ADVISOR_UNAVAILABLE
            and self._settings.demo_mode
            and self._advisor.provider != "mock"
        )

    @staticmethod
    def _finalize(
        response: AdvisorResponse,
        request: AdvisorRequest,
        *,
        provider: str,
        model: str | None,
        fallback_reason: str | None,
    ) -> AdvisorResponse:
        return response.model_copy(
            update={
                "risks": response.risks[:MAX_LIST_ITEMS],
                "proposed_actions": response.proposed_actions[:MAX_LIST_ITEMS],
                "meta": AdvisorMeta(
                    provider=provider,  # type: ignore[arg-type]
                    model=model,
                    language=request.language,
                    channel=request.channel,
                    fallback_reason=fallback_reason,
                ),
            }
        )
