from __future__ import annotations

from fastapi import APIRouter, Depends

from app.config import Settings, get_settings
from app.risk.schemas import RiskRequest, RiskResponse
from app.risk.service import RiskService
from app.security import require_internal_caller

router = APIRouter(prefix="/v1/risk", tags=["risk"])


def _service(settings: Settings = Depends(get_settings)) -> RiskService:
    return RiskService(settings)


@router.post(
    "/invoice",
    response_model=RiskResponse,
    response_model_by_alias=True,
    dependencies=[Depends(require_internal_caller)],
)
def score_invoice(
    request: RiskRequest,
    service: RiskService = Depends(_service),
) -> RiskResponse:
    """Anomaly detection against this user's vendor history — not a fraud verdict."""
    return service.score(request)
