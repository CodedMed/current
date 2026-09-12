"""Invoice anomaly/risk detection — deliberately *not* a fraud verdict.

The question answered is "how unusual is this invoice compared with this user's history for this
vendor?". Deterministic rules carry the score on their own until the vendor has enough history for
the Isolation Forest to say anything meaningful.
"""

from __future__ import annotations

import logging

from app.config import Settings
from app.risk import rules
from app.risk.features import MINIMUM_HISTORY_FOR_ML, build_features, build_history_features
from app.risk.isolation_forest import (
    ML_WEIGHT,
    MODEL_VERSION,
    RULES_WEIGHT,
    anomaly_percentile,
)
from app.risk.schemas import RiskRequest, RiskResponse, severity_for

log = logging.getLogger(__name__)


class RiskService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def score(self, request: RiskRequest) -> RiskResponse:
        invoice = request.invoice
        history = request.history

        rules_score, reasons = rules.score(invoice, history)

        ml_score: float | None = None
        if len(history) >= MINIMUM_HISTORY_FOR_ML:
            ml_score = anomaly_percentile(
                build_features(invoice, history),
                build_history_features(invoice.vendor_key, history),
            )

        if ml_score is None:
            risk_score = rules_score
        else:
            risk_score = RULES_WEIGHT * rules_score + ML_WEIGHT * ml_score
        risk_score = min(max(risk_score, 0.0), 1.0)

        return RiskResponse(
            risk_score=risk_score,
            severity=severity_for(risk_score),
            rules_score=rules_score,
            ml_score=ml_score,
            reasons=reasons,
            model_version=MODEL_VERSION,
        )
