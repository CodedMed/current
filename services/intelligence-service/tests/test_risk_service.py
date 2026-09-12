from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.risk.isolation_forest import ML_WEIGHT, MODEL_VERSION, RULES_WEIGHT
from app.risk.schemas import RiskRequest
from app.risk.service import RiskService
from risk_factories import NEW_DESTINATION, historical, invoice, steady_history

client = TestClient(app)
TOKEN = {"X-Internal-Service-Token": get_settings().internal_service_token}


def _score(under_review, history):
    service = RiskService(get_settings())
    return service.score(RiskRequest(invoice=under_review, history=history))


def test_empty_history_is_scored_without_a_model():
    response = _score(invoice("1000"), [])

    assert response.ml_score is None
    assert response.severity == "LOW"
    assert response.reasons == ["No previous invoices from this vendor"]
    assert response.model_version == MODEL_VERSION


def test_a_single_historical_invoice_is_scored_without_a_model():
    response = _score(invoice("1300"), [historical("1000", days_ago=30)])

    assert response.ml_score is None
    assert response.risk_score == pytest.approx(response.rules_score)


def test_nine_historical_invoices_still_score_on_rules_alone():
    response = _score(invoice("1300"), steady_history(9))

    assert response.ml_score is None
    assert response.risk_score == pytest.approx(response.rules_score)


def test_ten_historical_invoices_blend_the_rules_with_the_anomaly_percentile():
    response = _score(invoice("1300"), steady_history(10))

    assert response.ml_score is not None
    assert 0.0 <= response.ml_score <= 1.0
    assert response.risk_score == pytest.approx(
        RULES_WEIGHT * response.rules_score + ML_WEIGHT * response.ml_score
    )


def test_the_anomaly_percentile_is_repeatable_for_the_same_invoice():
    first = _score(invoice("1300"), steady_history(10))
    second = _score(invoice("1300"), steady_history(10))

    assert first.ml_score == second.ml_score


def test_a_suspicious_invoice_is_high_and_a_normal_one_is_low():
    normal = _score(invoice("1000"), steady_history(10))
    suspicious = _score(
        invoice("1300", destination=NEW_DESTINATION), steady_history(10)
    )

    assert normal.severity == "LOW"
    assert suspicious.severity == "HIGH"
    assert suspicious.reasons


def test_the_endpoint_scores_the_suspicious_invoice_as_high():
    payload = RiskRequest(
        invoice=invoice("1300", destination=NEW_DESTINATION),
        history=steady_history(10),
    ).model_dump(by_alias=True, mode="json")

    response = client.post("/v1/risk/invoice", headers=TOKEN, json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["severity"] == "HIGH"
    assert body["modelVersion"] == MODEL_VERSION
    assert body["mlScore"] is not None
    assert "Payment details changed since this vendor's last invoice" in body["reasons"]


def test_the_endpoint_leaves_ml_score_null_without_enough_history():
    payload = RiskRequest(
        invoice=invoice("1000"), history=steady_history(9)
    ).model_dump(by_alias=True, mode="json")

    response = client.post("/v1/risk/invoice", headers=TOKEN, json=payload)

    assert response.status_code == 200
    assert response.json()["mlScore"] is None
