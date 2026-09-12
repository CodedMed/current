"""Deterministic stand-in for the local model, used when Ollama is unavailable.

Returns the suspicious vendor invoice from the demo scenario: 30% above the vendor's recent
charges, on a different payment destination, outside the usual monthly cadence.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from app.documents.privacy import invoice_number_hash
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
            # The demo invoice's printed reference, so uploading it twice reads as a duplicate.
            invoice_number_hash=invoice_number_hash("CP-2026-0061"),
            # The suspicious sample's remit-to details, as samples/invoices/generate.py prints them —
            # different from the seeded history's, so "payment details changed" fires in demo mode
            # exactly as it does for a live extraction of that PDF.
            payment_destination_fingerprint=(
                "sha256:d531f97a977931c2a348eb0466d1cd6d7b59f026247e6ef24c6d57d9747a89d8"
            ),
        )
