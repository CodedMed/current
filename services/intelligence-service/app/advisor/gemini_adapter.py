"""Gemini CFO reasoning.

Sends the CFO system prompt, the prior turns of the conversation and the already-allowlisted
``AdvisorContext`` to Gemini and asks for the ``AdvisorResponse`` shape as structured JSON output.
Gemini explains the numbers it is given; it never recomputes a balance, a gap date or a risk score,
and it never sees anything beyond the context the ledger service already sanitized (no raw
database rows, no document or OCR text).

Needs the ``ai`` extra (``google-genai``).
"""

from __future__ import annotations

import json
import logging

from google import genai
from google.genai import types
from pydantic import ValidationError

from app.advisor.schemas import AdvisorRequest, AdvisorResponse
from app.advisor.service import system_prompt
from app.config import Settings
from app.errors import ADVISOR_UNAVAILABLE, ApiError

log = logging.getLogger(__name__)

# Deliberately hand-written rather than AdvisorResponse.model_json_schema(): the generated schema
# emits keywords (``pattern``, ``default``) outside the subset Gemini's structured output accepts.
# Only JSON Schema keywords Gemini documents support are used here.
_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string", "description": "The full reply shown to the user."},
        "summary": {"type": "string", "description": "One-sentence summary of the financial position."},
        "risks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "severity": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH"]},
                    "explanation": {"type": "string"},
                },
                "required": ["title", "severity", "explanation"],
                "additionalProperties": False,
            },
        },
        "proposedActions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "rationale": {"type": "string"},
                    "priority": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH"]},
                    "dueDate": {
                        "anyOf": [{"type": "string", "format": "date"}, {"type": "null"}],
                        "description": "ISO date, or null if there is no natural deadline.",
                    },
                    "estimatedImpact": {
                        "anyOf": [{"type": "number"}, {"type": "null"}],
                        "description": "Dollar amount this action could recover or save, or null.",
                    },
                },
                "required": ["title", "rationale", "priority"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["answer", "summary", "risks", "proposedActions"],
    "additionalProperties": False,
}

_VOICE_STYLE = (
    "Delivery: this reply will be read aloud by a voice assistant. Write `answer` as two to four "
    "spoken sentences (about 90 words at most) in plain prose: no markdown, no bullet points, no "
    "headings, no symbols. Keep `summary`, `risks` and `proposedActions` structured as usual."
)


def build_contents(request: AdvisorRequest) -> list[types.Content]:
    """Prior turns as alternating user/model messages, then the question with its context.

    The history is continuity only; the context block is re-sent in full on every turn so the
    model always reasons over the ledger's current figures, not over what it said earlier.
    """
    contents: list[types.Content] = []
    for turn in request.history:
        role = "user" if turn.role == "user" else "model"
        contents.append(types.Content(role=role, parts=[types.Part.from_text(text=turn.content)]))

    context_json = request.context.model_dump(mode="json", by_alias=True)
    as_of = request.context.as_of_date.isoformat() if request.context.as_of_date else "not supplied"
    sections = [
        f"Requested reply language (BCP-47 code): {request.language}",
        f"Today's date (from the ledger): {as_of}",
    ]
    if request.channel == "voice":
        sections.append(_VOICE_STYLE)
    sections.append(f"User question: {request.message}")
    sections.append(
        "Allowlisted financial context — authoritative, do not recompute or contradict it:\n"
        f"{json.dumps(context_json)}"
    )
    contents.append(types.Content(role="user", parts=[types.Part.from_text(text="\n\n".join(sections))]))
    return contents


class GeminiAdvisor:
    provider = "gemini"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = genai.Client(api_key=settings.gemini_api_key)

    async def advise(self, request: AdvisorRequest) -> AdvisorResponse:
        try:
            response = await self._client.aio.models.generate_content(
                model=self._settings.gemini_model,
                contents=build_contents(request),
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt(),
                    response_mime_type="application/json",
                    response_json_schema=_RESPONSE_SCHEMA,
                    temperature=0.2,
                ),
            )
        except genai.errors.APIError as exc:
            log.warning("Gemini request failed: %s", exc)
            raise ApiError(
                ADVISOR_UNAVAILABLE,
                "The Gemini advisor is temporarily unavailable.",
                retryable=True,
            ) from exc
        except Exception as exc:  # network errors, timeouts, SDK transport failures
            log.warning("Gemini request could not be completed: %s", exc)
            raise ApiError(
                ADVISOR_UNAVAILABLE,
                "The Gemini advisor could not be reached.",
                retryable=True,
            ) from exc

        text = response.text
        if not text:
            raise ApiError(
                ADVISOR_UNAVAILABLE,
                "The Gemini advisor returned an empty response.",
                retryable=True,
            )

        try:
            payload = json.loads(text)
            return AdvisorResponse.model_validate(payload)
        except (json.JSONDecodeError, ValidationError, TypeError) as exc:
            log.warning("Gemini returned a schema-invalid response: %s", exc)
            raise ApiError(
                ADVISOR_UNAVAILABLE,
                "The Gemini advisor returned a malformed response.",
                retryable=False,
            ) from exc
