"""Invoice feature engineering for the anomaly engine.

Ten numeric features describe the invoice under review against the user's history with the same
vendor. Every value is a finite float: empty history and single-invoice history are the cases that
otherwise produce ``NaN`` or ``inf``.
"""

from __future__ import annotations

import math
from datetime import date
from statistics import median, pstdev

from app.risk.schemas import HistoricalInvoice, InvoiceUnderReview

MINIMUM_HISTORY_FOR_ML = 10

FEATURE_NAMES = (
    "log_amount",
    "amount_vs_vendor_mean",
    "amount_vendor_zscore",
    "price_change_pct",
    "days_since_previous_invoice",
    "cadence_deviation_days",
    "days_until_due",
    "duplicate_invoice_flag",
    "payment_destination_changed",
    "unknown_vendor_flag",
)


def build_features(
    invoice: InvoiceUnderReview, history: list[HistoricalInvoice]
) -> dict[str, float]:
    ordered = _most_recent_first(history)
    previous = ordered[0] if ordered else None

    amount = float(invoice.amount)
    amounts = [float(item.amount) for item in ordered]
    mean_amount = sum(amounts) / len(amounts) if amounts else 0.0
    spread = pstdev(amounts) if len(amounts) >= 2 else 0.0

    days_since_previous = _days_between(
        invoice.invoice_date, previous.invoice_date if previous else None
    )
    usual_gap = _median_gap(ordered)

    features = {
        "log_amount": math.log1p(max(amount, 0.0)),
        "amount_vs_vendor_mean": amount / mean_amount if mean_amount > 0 else 1.0,
        "amount_vendor_zscore": (amount - mean_amount) / spread if spread > 0 else 0.0,
        "price_change_pct": _price_change_pct(amount, previous),
        "days_since_previous_invoice": days_since_previous or 0.0,
        "cadence_deviation_days": (
            abs(days_since_previous - usual_gap)
            if days_since_previous is not None and usual_gap is not None
            else 0.0
        ),
        "days_until_due": _days_between(invoice.due_date, invoice.invoice_date) or 0.0,
        "duplicate_invoice_flag": _flag(_is_duplicate(invoice, ordered)),
        "payment_destination_changed": _flag(_destination_changed(invoice, previous)),
        "unknown_vendor_flag": _flag(not ordered),
    }
    return {name: _finite(features[name]) for name in FEATURE_NAMES}


def build_history_features(
    vendor_key: str, history: list[HistoricalInvoice]
) -> list[dict[str, float]]:
    """Feature rows for the vendor's own history, each scored against the invoices before it.

    The oldest invoice is skipped: with nothing preceding it, every comparison feature would fall
    back to a placeholder and plant a phantom outlier in the reference set.
    """
    ordered = _most_recent_first(history)
    return [
        build_features(_as_invoice_under_review(vendor_key, ordered[index]), ordered[index + 1 :])
        for index in range(len(ordered) - 1)
    ]


def _as_invoice_under_review(
    vendor_key: str, historical: HistoricalInvoice
) -> InvoiceUnderReview:
    # paid_date stands in for the due date so days_until_due varies across the reference set
    # instead of collapsing to a constant zero column the model would read as signal.
    return InvoiceUnderReview(
        vendor_key=vendor_key,
        amount=historical.amount,
        invoice_date=historical.invoice_date,
        due_date=historical.paid_date,
        invoice_number_hash=historical.invoice_number_hash,
        payment_destination_fingerprint=historical.payment_destination_fingerprint,
    )


def _most_recent_first(history: list[HistoricalInvoice]) -> list[HistoricalInvoice]:
    # Callers may hand us either order; sorting on the date keeps "previous invoice" honest, and
    # undated entries keep their original relative position.
    return sorted(
        history,
        key=lambda item: (item.invoice_date is not None, item.invoice_date),
        reverse=True,
    )


def _days_between(later: date | None, earlier: date | None) -> float | None:
    if later is None or earlier is None:
        return None
    return float((later - earlier).days)


def _median_gap(ordered: list[HistoricalInvoice]) -> float | None:
    dates = [item.invoice_date for item in ordered if item.invoice_date is not None]
    if len(dates) < 2:
        return None
    return median(float((dates[i] - dates[i + 1]).days) for i in range(len(dates) - 1))


def _price_change_pct(amount: float, previous: HistoricalInvoice | None) -> float:
    if previous is None:
        return 0.0
    previous_amount = float(previous.amount)
    if previous_amount <= 0:
        return 0.0
    return (amount - previous_amount) / previous_amount


def duplicate_kind(
    invoice: InvoiceUnderReview, history: list[HistoricalInvoice]
) -> str | None:
    """``"number"`` when the invoice reference was seen before, ``"amount_and_date"`` when only the
    amount and date coincide, ``None`` otherwise.

    The reference is the stronger signal in both directions: a re-issued invoice with a corrected
    amount is still the same invoice, and two invoices that both carry numbers which differ are
    different documents even if they happen to share a day and a total. The amount-and-date proxy
    therefore only compares against history that carries no number of its own."""
    if invoice.invoice_number_hash:
        if any(item.invoice_number_hash == invoice.invoice_number_hash for item in history):
            return "number"
        comparable = [item for item in history if not item.invoice_number_hash]
    else:
        comparable = history
    if any(
        item.amount == invoice.amount and item.invoice_date == invoice.invoice_date
        for item in comparable
    ):
        return "amount_and_date"
    return None


def _is_duplicate(invoice: InvoiceUnderReview, ordered: list[HistoricalInvoice]) -> bool:
    return duplicate_kind(invoice, ordered) is not None


def _destination_changed(
    invoice: InvoiceUnderReview, previous: HistoricalInvoice | None
) -> bool:
    if previous is None:
        return False
    known = previous.payment_destination_fingerprint
    current = invoice.payment_destination_fingerprint
    return bool(known and current and known != current)


def _flag(value: bool) -> float:
    return 1.0 if value else 0.0


def _finite(value: float) -> float:
    return float(value) if math.isfinite(value) else 0.0
