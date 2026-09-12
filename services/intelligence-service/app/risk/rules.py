"""Deterministic invoice risk rules.

Six rules, each worth a fixed weight, each emitting one plain-language reason. The total is
clamped to [0, 1]. These rules are deterministic on purpose: no model decides them.
"""

from __future__ import annotations

from app.risk.features import build_features, duplicate_kind
from app.risk.schemas import HistoricalInvoice, InvoiceUnderReview

WEIGHTS = {
    "payment_destination_changed": 0.35,
    "duplicate_invoice": 0.35,
    "price_increase_over_25_percent": 0.20,
    "amount_zscore_over_3": 0.20,
    "cadence_deviation_over_14_days": 0.10,
    "unknown_vendor": 0.10,
}

PRICE_INCREASE_THRESHOLD = 0.25
AMOUNT_ZSCORE_THRESHOLD = 3.0
CADENCE_DEVIATION_THRESHOLD_DAYS = 14.0


def score(invoice: InvoiceUnderReview, history: list[HistoricalInvoice]) -> tuple[float, list[str]]:
    features = build_features(invoice, history)
    triggered: list[tuple[str, str]] = []

    if features["payment_destination_changed"]:
        triggered.append(
            (
                "payment_destination_changed",
                "Payment details changed since this vendor's last invoice",
            )
        )

    if features["duplicate_invoice_flag"]:
        reason = (
            "This invoice number has already been recorded for this vendor"
            if duplicate_kind(invoice, history) == "number"
            else "This vendor already has an invoice for the same amount on the same date"
        )
        triggered.append(("duplicate_invoice", reason))

    price_change = features["price_change_pct"]
    if price_change > PRICE_INCREASE_THRESHOLD:
        triggered.append(
            (
                "price_increase_over_25_percent",
                f"Amount is {round(price_change * 100)}% above the vendor's previous charge",
            )
        )

    if features["amount_vendor_zscore"] > AMOUNT_ZSCORE_THRESHOLD:
        triggered.append(
            (
                "amount_zscore_over_3",
                f"Amount is {features['amount_vs_vendor_mean']:.1f}x this vendor's typical invoice",
            )
        )

    cadence_deviation = features["cadence_deviation_days"]
    if cadence_deviation > CADENCE_DEVIATION_THRESHOLD_DAYS:
        triggered.append(
            (
                "cadence_deviation_over_14_days",
                f"Invoice arrived {round(cadence_deviation)} days off this vendor's usual schedule",
            )
        )

    if features["unknown_vendor_flag"]:
        triggered.append(("unknown_vendor", "No previous invoices from this vendor"))

    total = min(sum(WEIGHTS[key] for key, _ in triggered), 1.0)
    return total, [reason for _, reason in triggered]
