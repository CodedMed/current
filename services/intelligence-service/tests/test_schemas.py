from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.documents.schemas import ExtractedInvoice
from app.risk.schemas import RiskRequest, RiskResponse, severity_for


def test_extracted_invoice_accepts_the_documented_shape():
    invoice = ExtractedInvoice(
        vendor_key="cloud_provider",
        vendor_display_name="Cloud Provider",
        amount=Decimal("1300.00"),
        previous_amount=Decimal("1000.00"),
        invoice_date=date(2026, 9, 11),
        due_date=date(2026, 9, 28),
        recurring=True,
        category="cloud_services",
        confidence=0.96,
    )

    assert invoice.direction == "OUT"
    assert invoice.model_dump(by_alias=True)["vendorKey"] == "cloud_provider"


def test_confidence_outside_zero_to_one_is_rejected():
    with pytest.raises(ValidationError):
        ExtractedInvoice(vendor_key="v", amount=Decimal("1"), category="c", confidence=1.5)


def test_unknown_fields_are_rejected_so_models_cannot_smuggle_data_through():
    with pytest.raises(ValidationError):
        ExtractedInvoice(
            vendor_key="v",
            amount=Decimal("1"),
            category="c",
            confidence=0.5,
            account_number="123456789",
        )


def test_severity_thresholds_follow_the_specification():
    assert severity_for(0.00) == "LOW"
    assert severity_for(0.39) == "LOW"
    assert severity_for(0.40) == "MEDIUM"
    assert severity_for(0.69) == "MEDIUM"
    assert severity_for(0.70) == "HIGH"
    assert severity_for(1.00) == "HIGH"


def test_risk_request_parses_camel_case_from_the_bff():
    request = RiskRequest.model_validate(
        {
            "invoice": {
                "vendorKey": "cloud_provider",
                "amount": 1300,
                "paymentDestinationFingerprint": "sha256:new",
            },
            "history": [{"amount": 1000, "paymentDestinationFingerprint": "sha256:old"}],
        }
    )

    assert request.invoice.vendor_key == "cloud_provider"
    assert request.history[0].amount == Decimal("1000")


def test_risk_response_serialises_camel_case():
    payload = RiskResponse(
        risk_score=0.55,
        severity="MEDIUM",
        rules_score=0.55,
        reasons=["Payment destination changed"],
        model_version="invoice-risk-mock-v0",
    ).model_dump(by_alias=True)

    assert payload["riskScore"] == 0.55
    assert payload["modelVersion"] == "invoice-risk-mock-v0"
    assert payload["mlScore"] is None
