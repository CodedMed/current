from __future__ import annotations

from fastapi import APIRouter, Depends

from app.config import Settings, get_settings
from app.i18n.schemas import TranslateRequest, TranslateResponse
from app.i18n.service import TranslationService
from app.security import require_internal_caller

router = APIRouter(prefix="/v1/i18n", tags=["i18n"])


def _service(settings: Settings = Depends(get_settings)) -> TranslationService:
    return TranslationService(settings)


@router.post("/translate", response_model=TranslateResponse, dependencies=[Depends(require_internal_caller)])
async def translate(
    request: TranslateRequest,
    service: TranslationService = Depends(_service),
) -> TranslateResponse:
    """Translates interface strings. Anything that could not be translated is simply absent."""
    return await service.translate(request.strings, request.language)


@router.get("/languages", dependencies=[Depends(require_internal_caller)])
def languages(service: TranslationService = Depends(_service)) -> dict[str, list[dict[str, str]]]:
    return {"languages": service.languages()}
