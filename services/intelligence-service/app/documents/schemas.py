"""Structured output contract for private document extraction.

Model output is never trusted: everything is validated through these models before it can leave
the service, and no field here can carry an account number, routing number, address or tax id.

Two shapes, deliberately: ``ModelExtraction`` is what the local model is asked for and never leaves
this process; ``ExtractedInvoice`` is what goes on the wire. The only difference is that the
invoice's reference number is replaced by a local hash on the way out.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.documents.privacy import invoice_number_hash
from app.money import Money


class _InvoiceFields(BaseModel):
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


class ModelExtraction(_InvoiceFields):
    """The local model's answer. Stays in-process: ``to_extracted`` is the only way out."""

    invoice_number: str | None = Field(default=None, max_length=64)
    # The prompt asks for null; tolerated so a model echoing the example shape still validates.
    # Whatever it contains is discarded — the fingerprint is computed locally from the text.
    payment_destination_fingerprint: str | None = None


class ExtractedInvoice(_InvoiceFields):
    """What leaves the service: identifiers only ever as one-way hashes."""

    invoice_number_hash: str | None = Field(default=None, pattern=r"^sha256:[a-f0-9]{64}$")
    payment_destination_fingerprint: str | None = Field(default=None, pattern=r"^sha256:[a-f0-9]{64}$")


def to_extracted(model: ModelExtraction) -> ExtractedInvoice:
    """Replaces the raw invoice number with its local hash; the number itself goes no further."""
    fields = model.model_dump(exclude={"invoice_number", "payment_destination_fingerprint"})
    return ExtractedInvoice(**fields, invoice_number_hash=invoice_number_hash(model.invoice_number))


class ExtractionResponse(BaseModel):
    """Camel-cased on the wire to match the ledger service and the BFF."""

    model_config = ConfigDict(populate_by_name=True)

    document_type: str = Field(default="invoice", serialization_alias="documentType")
    extraction: ExtractedInvoice
    warnings: list[str] = Field(default_factory=list)
