from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.money import Money

Severity = Literal["LOW", "MEDIUM", "HIGH"]


class _CamelModel(BaseModel):
    # protected_namespaces is cleared so `model_version` can stay the field name from the contract.
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, protected_namespaces=()
    )


class InvoiceUnderReview(_CamelModel):
    vendor_key: str
    vendor_display_name: str | None = None
    amount: Money
    invoice_date: date | None = None
    due_date: date | None = None
    invoice_number_hash: str | None = None
    payment_destination_fingerprint: str | None = None


class HistoricalInvoice(_CamelModel):
    amount: Money
    invoice_date: date | None = None
    paid_date: date | None = None
    invoice_number_hash: str | None = None
    payment_destination_fingerprint: str | None = None


class RiskRequest(_CamelModel):
    invoice: InvoiceUnderReview
    history: list[HistoricalInvoice] = Field(default_factory=list)


class RiskResponse(_CamelModel):
    risk_score: float = Field(ge=0, le=1)
    severity: Severity
    rules_score: float = Field(ge=0, le=1)
    ml_score: float | None = None
    reasons: list[str] = Field(default_factory=list)
    model_version: str


def severity_for(score: float) -> Severity:
    if score >= 0.70:
        return "HIGH"
    if score >= 0.40:
        return "MEDIUM"
    return "LOW"
