from __future__ import annotations

import pytest

from app.risk import rules
from app.risk.rules import WEIGHTS
from risk_factories import NEW_DESTINATION, historical, invoice, steady_history


def test_an_ordinary_invoice_triggers_nothing():
    total, reasons = rules.score(invoice("1000"), steady_history(10))

    assert total == 0.0
    assert reasons == []


def test_a_vendor_with_no_history_is_the_only_trigger_on_a_first_invoice():
    total, reasons = rules.score(invoice("1000"), [])

    assert total == pytest.approx(WEIGHTS["unknown_vendor"])
    assert reasons == ["No previous invoices from this vendor"]


def test_a_thirty_percent_increase_is_reported_in_the_user_s_words():
    total, reasons = rules.score(invoice("1300"), [historical("1000", days_ago=30)])

    assert total == pytest.approx(WEIGHTS["price_increase_over_25_percent"])
    assert reasons == ["Amount is 30% above the vendor's previous charge"]


def test_a_changed_payment_destination_is_the_heaviest_rule():
    total, reasons = rules.score(
        invoice("1000", destination=NEW_DESTINATION), steady_history(10)
    )

    assert total == pytest.approx(WEIGHTS["payment_destination_changed"])
    assert reasons == ["Payment details changed since this vendor's last invoice"]


def test_a_first_invoice_from_a_vendor_cannot_have_a_changed_destination():
    _, reasons = rules.score(invoice("1000", destination=NEW_DESTINATION), [])

    assert "Payment details changed since this vendor's last invoice" not in reasons


def test_an_exact_duplicate_of_an_earlier_invoice_triggers():
    history = steady_history(10)
    repeat = invoice("1000", days_ago=30)

    total, reasons = rules.score(repeat, history)

    assert "This vendor already has an invoice for the same amount on the same date" in reasons
    # Re-billing on a date the vendor already invoiced also breaks the 30-day cadence.
    assert total == pytest.approx(
        WEIGHTS["duplicate_invoice"] + WEIGHTS["cadence_deviation_over_14_days"]
    )


def test_an_invoice_off_the_vendor_s_cadence_triggers():
    total, reasons = rules.score(invoice("1000"), steady_history(10, starting_days_ago=60))

    assert total == pytest.approx(WEIGHTS["cadence_deviation_over_14_days"])
    assert reasons == ["Invoice arrived 30 days off this vendor's usual schedule"]


def test_an_amount_far_outside_the_vendor_range_triggers_the_zscore_rule():
    total, reasons = rules.score(invoice("1300"), steady_history(10))

    assert total == pytest.approx(
        WEIGHTS["price_increase_over_25_percent"] + WEIGHTS["amount_zscore_over_3"]
    )
    assert "Amount is 1.3x this vendor's typical invoice" in reasons


def test_the_total_is_clamped_to_one_when_five_rules_trigger_at_once():
    repeated = historical("1300", days_ago=600)
    history = [historical("1000", days_ago=30 + index * 30) for index in range(19)] + [repeated]

    total, reasons = rules.score(
        invoice("1300", days_ago=600, destination=NEW_DESTINATION), history
    )

    assert total == 1.0
    assert len(reasons) == 5


def test_no_reason_describes_the_invoice_as_fraud():
    _, reasons = rules.score(
        invoice("1300", destination=NEW_DESTINATION), steady_history(10)
    )

    assert reasons
    assert not any("fraud" in reason.lower() for reason in reasons)
