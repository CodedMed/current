"""The demo advisor must answer the *question* from the *context*: grounded, ranked, bilingual."""

from __future__ import annotations

import asyncio

from app.advisor.mock_adapter import MockAdvisor, classify
from advisor_factories import demo_context, request


def ask(message: str, **kwargs):
    return asyncio.run(MockAdvisor().advise(request(message, **kwargs)))


def test_routes_the_product_questions_to_distinct_intents():
    assert classify("How much cash do I have available?") == "cash"
    assert classify("What are my biggest upcoming expenses?") == "expenses"
    assert classify("Will I have enough cash to pay my invoices?") == "afford"
    assert classify("When might I run into a cash-flow gap?") == "gap"
    assert classify("What happens if this invoice is paid late?") == "late_payment"
    assert classify("Why is my projected cash balance going down?") == "gap"
    assert classify("Which overdue invoice should I follow up on first?") == "overdue"
    assert classify("What should I prioritize this week?") == "prioritize"
    assert classify("Can I afford this upcoming expense based on my current cash flow?") == "afford"
    assert classify("How is my business doing financially?") == "overview"
    assert classify("¿Cuánto efectivo tengo disponible?") == "cash"


def test_cash_question_quotes_the_ledger_balance_and_labels_projections():
    reply = ask("How much cash do I have available?")

    assert "$8,000" in reply.answer
    assert reply.answer.startswith("Fact:")
    assert "Projection:" in reply.answer
    assert reply.summary == "$8,000 available today."


def test_expenses_are_ranked_by_amount_with_their_due_dates():
    reply = ask("What are my biggest upcoming expenses?")

    lines = reply.answer.split("\n")
    assert "Quarterly estimated tax payment — $4,500" in lines[1]
    assert "Harbor Property Group — $2,200" in lines[2]
    assert "2026-10-09" in lines[1]
    assert reply.summary.startswith("Largest upcoming expense: Quarterly estimated tax payment")


def test_overdue_question_ranks_the_largest_receivable_first_and_ties_it_to_the_gap():
    context = demo_context()
    context["overdueReceivables"] = [
        {"counterpartyLabel": "Client Z", "amount": 900, "daysOverdue": 30},
        {"counterpartyLabel": "Client A", "amount": 4000, "daysOverdue": 12},
    ]
    reply = ask("Which overdue invoice should I follow up on first?", context=context)

    assert reply.answer.startswith("Follow up with Client A first: $4,000 is 12 days overdue")
    assert "Then Client Z: $900, 30 days overdue." in reply.answer
    assert "$1,200 gap on 2026-10-09" in reply.answer
    assert [a.title for a in reply.proposed_actions] == ["Follow up with Client A", "Follow up with Client Z"]
    assert reply.proposed_actions[0].estimated_impact == 4000


def test_gap_explanation_connects_the_overdue_receivable_to_the_shortfall():
    reply = ask("Why is my projected cash balance going down?")

    assert "$13,500" in reply.answer and "$6,500" in reply.answer
    assert "The overdue $4,000 from Client A is larger than the $1,200 shortfall" in reply.answer
    assert reply.risks[0].title == "Upcoming cash gap"
    assert reply.proposed_actions[0].title == "Follow up with Client A"
    # The gap-preparation action names the obligation from the context, not an invented one.
    assert reply.proposed_actions[1].title == "Set aside cash for Quarterly estimated tax payment ($4,500)"
    assert reply.proposed_actions[1].due_date.isoformat() == "2026-10-02"


def test_priorities_keep_the_existing_contract_for_the_demo_walkthrough():
    reply = ask("What should I do first?")

    assert "2026-10-09" in reply.summary
    assert reply.proposed_actions[0].title == "Follow up with Client A"
    assert reply.proposed_actions[0].priority == "HIGH"
    assert "needs your approval" in reply.answer


def test_affordability_compares_the_amount_with_the_projected_low_point_without_recomputing():
    healthy = demo_context()
    healthy.update({"firstGapDate": None, "firstGapAmount": None, "daysUntilGap": None, "projectedLowPoint": {"date": "2026-10-09", "balance": 900, "label": "Rent"}})

    within = ask("Can I afford a $500 purchase?", context=healthy)
    beyond = ask("Can I afford a $3,000 purchase?")

    assert within.summary == "$500 fits inside the projected low point of $900."
    assert "as a projection, not a guarantee" in within.answer
    assert beyond.summary == "$3,000 exceeds the projected low point of -$1,200; collect first."
    # No new balance is computed: only the supplied low point and the user's amount are quoted.
    assert "$400" not in within.answer and "$1,800" not in beyond.answer


def test_late_payment_scenario_names_the_receivable_and_the_direction_of_change():
    reply = ask("What happens if Client D pays late?")

    assert "$2,500 from Client D on 2026-10-01" in reply.answer
    assert "grows by up to $2,500" in reply.answer
    assert "I have not recomputed the forecast" in reply.answer
    assert reply.proposed_actions[0].title == "Confirm the payment date with Client D"


def test_invoice_risk_question_explains_the_score_is_not_a_fraud_verdict():
    reply = ask("Is there anything suspicious in my vendor invoices?")

    assert "Cloud Provider: score 0.87 (HIGH)" in reply.answer
    assert "not that it is fraud" in reply.answer
    assert reply.proposed_actions[0].title == "Review the flagged invoice from Cloud Provider"


def test_says_what_it_does_not_have_instead_of_inventing_data():
    bare = {"currentCash": 8000, "expectedInflow30d": 6500, "expectedOutflow30d": 13500}
    reply = ask("What are my biggest upcoming expenses?", context=bare)

    assert "does not include a list of upcoming obligations" in reply.answer
    assert reply.proposed_actions == []


def test_never_names_a_counterparty_that_is_not_in_the_context():
    context = demo_context()
    context["overdueReceivables"] = []
    reply = ask("Which overdue invoice should I follow up on first?", context=context)

    assert "Client A" not in reply.answer
    assert reply.answer == "Fact: no receivables are overdue in the ledger right now."


def test_spanish_replies_are_spanish_and_keep_the_numbers():
    reply = ask("¿Cuánto efectivo tengo disponible?", language="es")

    assert reply.answer.startswith("Hecho: tienes $8,000 disponibles")
    assert reply.summary == "$8,000 disponibles hoy."
    assert reply.risks[0].title == "Brecha de efectivo próxima"


def test_voice_channel_gives_a_short_spoken_answer_with_the_same_structure():
    text = ask("What should I do first?")
    voice = ask("What should I do first?", channel="voice")

    assert "\n" not in voice.answer
    assert len(voice.answer.split()) < len(text.answer.split())
    assert "October 9" in voice.answer  # dates are spoken, not ISO
    assert "My first recommendation: Follow up with Client A." in voice.answer
    assert [a.title for a in voice.proposed_actions] == [a.title for a in text.proposed_actions]
