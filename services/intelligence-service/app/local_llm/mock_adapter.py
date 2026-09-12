"""Deterministic stand-in for the local model, used when Ollama is unavailable.

Returns the suspicious vendor invoice from the demo scenario: 30% above the vendor's recent
charges, on a different payment destination, outside the usual monthly cadence.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from app.documents.schemas import ExtractedInvoice


class MockLocalExtractor:
    """Ignores the document text entirely — nothing private is inspected or retained."""

    async def extract_invoice(self, text: str) -> ExtractedInvoice:
        today = date.today()
        return ExtractedInvoice(
            vendor_key="cloud_provider",
            vendor_display_name="Cloud Provider",
            amount=Decimal("1300.00"),
            previous_amount=Decimal("1000.00"),
            invoice_date=today,
            due_date=today + timedelta(days=17),
            recurring=True,
            category="cloud_services",
            confidence=0.96,
            payment_destination_fingerprint=(
                "sha256:" + "a" * 64
            ),
        )
