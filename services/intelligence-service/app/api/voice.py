from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.advisor.schemas import AdvisorRequest, AdvisorResponse
from app.advisor.service import AdvisorService
from app.config import Settings, get_settings
from app.security import require_internal_caller
from app.voice.service import VoiceService

router = APIRouter(prefix="/v1/voice", tags=["voice"])


class VoiceSessionRequest(BaseModel):
    language: str = "en"


def _service(settings: Settings = Depends(get_settings)) -> VoiceService:
    return VoiceService(settings, AdvisorService(settings))


@router.post("/session", dependencies=[Depends(require_internal_caller)])
def create_session(
    request: VoiceSessionRequest,
    service: VoiceService = Depends(_service),
) -> dict:
    return service.session(request.language)


@router.post(
    "/message",
    response_model=AdvisorResponse,
    response_model_by_alias=True,
    dependencies=[Depends(require_internal_caller)],
)
async def message(
    request: AdvisorRequest,
    service: VoiceService = Depends(_service),
) -> AdvisorResponse:
    """A spoken turn runs the same advisor logic as the text surface."""
    return await service.message(request)
