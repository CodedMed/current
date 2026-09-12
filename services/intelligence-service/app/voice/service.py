"""Voice advisor bridge.

Speech in, the same Gemini CFO logic in the middle, speech out. Without credentials the UI simply
stays on text, which is why this reports availability rather than failing the page.

How a spoken turn reaches the shared reasoning path: the browser connects to the ElevenLabs agent
with the signed URL minted here and registers one *client tool*, named ``VOICE_CLIENT_TOOL``. The
agent is configured (see the README) to call that tool with the user's question for every financial
question; the browser answers it by calling the BFF's ``/voice/message``, which lands in
``VoiceService.message`` and therefore in ``AdvisorService.chat`` — the identical pipeline the text
surface uses. The agent then speaks the returned answer. ElevenLabs only ever sees the microphone
audio and that sanitized answer.
"""

from __future__ import annotations

from app.advisor.schemas import AdvisorRequest, AdvisorResponse
from app.advisor.service import AdvisorService
from app.config import Settings

# The client tool the ElevenLabs agent must expose. Kept in one place so the browser, the docs and
# the agent configuration agree.
VOICE_CLIENT_TOOL = "ask_cash_flow_advisor"


class VoiceService:
    def __init__(self, settings: Settings, advisor: AdvisorService) -> None:
        self._settings = settings
        self._advisor = advisor

    def session(self, language: str) -> dict:
        if language not in self._settings.supported_languages:
            language = self._settings.supported_languages[0]
        if not self._settings.elevenlabs_enabled:
            reason = (
                "ELEVENLABS_API_KEY is not configured; the advisor stays on text."
                if not self._settings.elevenlabs_api_key
                else "ELEVENLABS_AGENT_ID is not configured; the advisor stays on text."
            )
            return {
                "available": False,
                "mode": "text",
                "language": language,
                "supportedLanguages": list(self._settings.supported_languages),
                "reason": reason,
            }
        from app.voice.elevenlabs_adapter import ElevenLabsVoiceAdapter

        session = ElevenLabsVoiceAdapter(self._settings).create_session(language)
        session["supportedLanguages"] = list(self._settings.supported_languages)
        session["clientToolName"] = VOICE_CLIENT_TOOL
        return session

    async def message(self, request: AdvisorRequest) -> AdvisorResponse:
        """A spoken turn is an advisor turn: identical reasoning, different transport.

        Only the delivery hint differs (``channel="voice"`` asks for a reply that reads well aloud);
        context, safety rules, validation and fallback behaviour are exactly the text path's.
        """
        return await self._advisor.chat(request.model_copy(update={"channel": "voice"}))
