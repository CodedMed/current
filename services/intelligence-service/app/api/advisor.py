from __future__ import annotations

from fastapi import APIRouter, Depends

from app.advisor.schemas import AdvisorRequest, AdvisorResponse
from app.advisor.service import AdvisorService
from app.config import Settings, get_settings
from app.security import require_internal_caller

router = APIRouter(prefix="/v1/advisor", tags=["advisor"])


def _service(settings: Settings = Depends(get_settings)) -> AdvisorService:
    return AdvisorService(settings)


@router.post(
    "/chat",
    response_model=AdvisorResponse,
    response_model_by_alias=True,
    dependencies=[Depends(require_internal_caller)],
)
async def chat(
    request: AdvisorRequest,
    service: AdvisorService = Depends(_service),
) -> AdvisorResponse:
    """Reasons over computed facts only; the numbers themselves come from the ledger service."""
    return await service.chat(request)
