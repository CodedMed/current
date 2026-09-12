from __future__ import annotations

import math

import pytest

from app.risk.features import FEATURE_NAMES, build_features, build_history_features
from risk_factories import VENDOR, historical, invoice, steady_history


def test_empty_history_produces_ten_finite_features():
    features = build_features(invoice(), [])

    assert set(features) == set(FEATURE_NAMES)
    assert all(math.isfinite(value) for value in features.values())
    assert features["unknown_vendor_flag"] == 1.0
    assert features["amount_vs_vendor_mean"] == 1.0
    assert features["amount_vendor_zscore"] == 0.0
    assert features["price_change_pct"] == 0.0
    assert features["cadence_deviation_days"] == 0.0


def test_single_invoice_history_has_no_spread_and_no_cadence():
    features = build_features(invoice("1300"), [historical("1000", days_ago=30)])

    assert all(math.isfinite(value) for value in features.values())
    assert features["amount_vendor_zscore"] == 0.0
    assert features["cadence_deviation_days"] == 0.0
    assert features["price_change_pct"] == pytest.approx(0.30)
    assert features["unknown_vendor_flag"] == 0.0


def test_a_zero_amount_in_history_does_not_divide_by_zero():
    features = build_features(invoice("1000"), [historical("0", days_ago=30)])

    assert all(math.isfinite(value) for value in features.values())
    assert features["price_change_pct"] == 0.0


def test_history_is_read_most_recent_first_whatever_order_it_arrives_in():
    history = steady_history(5)

    assert build_features(invoice("1300"), list(reversed(history))) == build_features(
        invoice("1300"), history
    )


def test_days_until_due_comes_from_the_invoice_dates():
    features = build_features(invoice(due_in_days=8), steady_history(5))

    assert features["days_until_due"] == 8.0


def test_a_steady_vendor_leaves_the_comparison_features_near_zero():
    features = build_features(invoice("1000"), steady_history(10))

    assert features["price_change_pct"] == 0.0
    assert features["cadence_deviation_days"] == 0.0
    assert abs(features["amount_vendor_zscore"]) < 3.0
    assert features["duplicate_invoice_flag"] == 0.0
    assert features["payment_destination_changed"] == 0.0


def test_reference_rows_skip_the_oldest_invoice_so_it_cannot_look_like_a_new_vendor():
    rows = build_history_features(VENDOR, steady_history(10))

    assert len(rows) == 9
    assert all(row["unknown_vendor_flag"] == 0.0 for row in rows)
    assert all(math.isfinite(value) for row in rows for value in row.values())
