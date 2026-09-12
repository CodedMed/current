"""Invoice builders shared by the risk tests."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from app.risk.schemas import HistoricalInvoice, InvoiceUnderReview

VENDOR = "cloud_provider"
KNOWN_DESTINATION = "sha256:known-account"
NEW_DESTINATION = "sha256:new-account"

TODAY = date(2026, 9, 11)
CADENCE_DAYS = 30
PAYMENT_TERM_DAYS = 14

_STEADY_AMOUNTS = ("1000", "1005", "995", "1010", "990")


def invoice(
    amount: str = "1000",
    *,
    days_ago: int = 0,
    destination: str | None = KNOWN_DESTINATION,
    due_in_days: int = PAYMENT_TERM_DAYS,
) -> InvoiceUnderReview:
    invoice_date = TODAY - timedelta(days=days_ago)
    return InvoiceUnderReview(
        vendor_key=VENDOR,
        vendor_display_name="Cloud Provider",
        amount=Decimal(amount),
        invoice_date=invoice_date,
        due_date=invoice_date + timedelta(days=due_in_days),
        payment_destination_fingerprint=destination,
    )


def historical(
    amount: str = "1000",
    *,
    days_ago: int,
    destination: str | None = KNOWN_DESTINATION,
) -> HistoricalInvoice:
    invoice_date = TODAY - timedelta(days=days_ago)
    return HistoricalInvoice(
        amount=Decimal(amount),
        invoice_date=invoice_date,
        paid_date=invoice_date + timedelta(days=PAYMENT_TERM_DAYS),
        payment_destination_fingerprint=destination,
    )


def steady_history(count: int, *, starting_days_ago: int = CADENCE_DAYS) -> list[HistoricalInvoice]:
    """A vendor billing about $1,000 every 30 days, most recent first."""
    return [
        historical(
            _STEADY_AMOUNTS[index % len(_STEADY_AMOUNTS)],
            days_ago=starting_days_ago + index * CADENCE_DAYS,
        )
        for index in range(count)
    ]
