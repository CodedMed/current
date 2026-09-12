"""Structured output contract for private document extraction.

Model output is never trusted: everything is validated through these models before it can leave
the service, and no field here can carry an account number, routing number, address or tax id.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.money import Money


class ExtractedInvoice(BaseModel):
    """Snake_case in Python, camelCase on the wire (the ledger service's invoice contract)."""

    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)

    vendor_key: str = Field(min_length=1, max_length=100, pattern=r"^[a-z][a-z0-9_]*$", description="Stable lowercase snake_case vendor company name, never the invoice number.")
    vendor_display_name: str | None = Field(default=None, max_length=160, pattern=r"^[^\r\n@\d]*$")
    amount: Money = Field(ge=0, max_digits=14, decimal_places=2)
    previous_amount: Money | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    invoice_date: date | None = None
    due_date: date | None = None
    recurring: bool = False
    category: str = Field(min_length=1, max_length=100, pattern=r"^[a-z][a-z0-9_]*$")
    direction: Literal["OUT"] = "OUT"
    confidence: float = Field(ge=0, le=1)
    payment_destination_fingerprint: str | None = Field(default=None, pattern=r"^sha256:[a-f0-9]{64}$")


class ExtractionResponse(BaseModel):
    """Camel-cased on the wire to match the ledger service and the BFF."""

    model_config = ConfigDict(populate_by_name=True)

    document_type: str = Field(default="invoice", serialization_alias="documentType")
    extraction: ExtractedInvoice
    warnings: list[str] = Field(default_factory=list)
