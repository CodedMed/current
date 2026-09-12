"""ElevenLabs speech transport.

Mints a short-lived signed WebSocket URL that the browser's ElevenLabs client connects to
directly, so the API key never reaches the browser. Voice is transport only: the actual turn is
still handled by ``AdvisorService.chat()`` through ``/v1/voice/message`` — this adapter never
reasons on its own. Privacy rules that must survive any change here:
  * no raw uploaded documents and no OCR text may be sent to the voice provider;
  * the voice layer only ever sees microphone audio and the sanitized advisor answer.

Needs the ``ai`` extra (``elevenlabs``).
"""

from __future__ import annotations

import logging

from elevenlabs.client import ElevenLabs
from elevenlabs.core.api_error import ApiError as ElevenLabsApiError

from app.config import Settings
from app.errors import VOICE_UNAVAILABLE, ApiError

log = logging.getLogger(__name__)


class ElevenLabsVoiceAdapter:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = ElevenLabs(api_key=settings.elevenlabs_api_key)

    def create_session(self, language: str) -> dict:
        try:
            response = self._client.conversational_ai.conversations.get_signed_url(
                agent_id=self._settings.elevenlabs_agent_id,
            )
        except ElevenLabsApiError as exc:
            log.warning("ElevenLabs signed-url request failed: %s", exc)
            raise ApiError(
                VOICE_UNAVAILABLE,
                "The voice session could not be started; falling back to text.",
                retryable=True,
            ) from exc

        return {
            "available": True,
            "mode": "voice",
            "language": language,
            "signedUrl": response.signed_url,
            "agentId": self._settings.elevenlabs_agent_id,
        }
