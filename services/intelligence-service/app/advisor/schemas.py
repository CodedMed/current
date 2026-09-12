"""Advisor wire shapes.

Two contracts live here. ``AdvisorContext`` mirrors the ledger service's allowlisted context and is
the *only* financial shape that may reach a model: unknown keys are dropped on validation, so a
field that is not declared below cannot be smuggled through to Gemini. ``AdvisorResponse`` is the
strict shape every adapter (Gemini or the deterministic mock) must produce; model output that does
not validate is rejected, never repaired.
"""

from __future__ import annotations

import datetime as dt
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.money import Money

Priority = Literal["LOW", "MEDIUM", "HIGH"]
Channel = Literal["text", "voice"]
Provider = Literal["gemini", "mock"]


class _CamelModel(BaseModel):
    # extra="ignore" is the sanitizer: anything the BFF or ledger adds that is not declared here
    # is dropped before ``model_dump`` builds the prompt.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


class OverdueReceivable(_CamelModel):
    counterparty_label: str | None = None
    amount: Money | None = None
    days_overdue: int | None = None


class ExpectedReceivable(_CamelModel):
    counterparty_label: str | None = None
    amount: Money | None = None
    due_date: date | None = None
    days_until_due: int | None = None


class ObligationSummary(_CamelModel):
    label: str | None = None
    category: str | None = None
    amount: Money | None = None
    due_date: date | None = None
    days_until_due: int | None = None
    status: str | None = None


class ProjectedPoint(_CamelModel):
    # ``dt.date`` because the field itself is named ``date`` and would shadow the type in the class body.
    date: dt.date | None = None
    balance: Money | None = None
    label: str | None = None


class InvoiceRiskSummary(_CamelModel):
    invoice_id: str | None = None
    vendor_label: str | None = None
    risk_score: float | None = None
    severity: str | None = None
    reasons: list[str] = Field(default_factory=list)


class TodoSummary(_CamelModel):
    id: str | None = None
    title: str | None = None
    status: str | None = None
    priority: str | None = None
    due_date: date | None = None


class AdvisorContext(_CamelModel):
    """Mirrors the ledger service's allowlisted context. Nothing else may reach the model.

    Every field is optional so an older ledger (or a partial context in tests) still validates;
    the adapters treat missing values as "not available" rather than guessing.
    """

    as_of_date: date | None = None
    horizon_days: int | None = None
    current_cash: Money | None = None
    expected_inflow30d: Money | None = Field(default=None, alias="expectedInflow30d")
    expected_outflow30d: Money | None = Field(default=None, alias="expectedOutflow30d")
    net30d: Money | None = Field(default=None, alias="net30d")
    expected_inflow60d: Money | None = Field(default=None, alias="expectedInflow60d")
    expected_outflow60d: Money | None = Field(default=None, alias="expectedOutflow60d")
    net60d: Money | None = Field(default=None, alias="net60d")
    first_gap_date: datetime | None = None
    first_gap_amount: Money | None = None
    days_until_gap: int | None = None
    projected_low_point: ProjectedPoint | None = None
    projected_end_balance: Money | None = None
    overdue_receivables: list[OverdueReceivable] = Field(default_factory=list)
    expected_receivables: list[ExpectedReceivable] = Field(default_factory=list)
    upcoming_obligations: list[ObligationSummary] = Field(default_factory=list)
    invoice_risks: list[InvoiceRiskSummary] = Field(default_factory=list)
    open_todos: list[TodoSummary] = Field(default_factory=list)


class ConversationTurn(_CamelModel):
    """A prior turn, for continuity only. Facts always come from ``context``, never from here."""

    role: Literal["user", "advisor"]
    content: str = Field(min_length=1, max_length=4000)


class AdvisorRequest(_CamelModel):
    message: str = Field(min_length=1, max_length=4000)
    language: str = "en"
    channel: Channel = "text"
    history: list[ConversationTurn] = Field(default_factory=list)
    context: AdvisorContext = Field(default_factory=AdvisorContext)


class RiskExplanation(_CamelModel):
    title: str = Field(min_length=1, max_length=200)
    severity: Priority
    explanation: str = Field(min_length=1, max_length=2000)


class ProposedAction(_CamelModel):
    title: str = Field(min_length=1, max_length=200)
    rationale: str = Field(min_length=1, max_length=2000)
    priority: Priority
    due_date: date | None = None
    estimated_impact: Money | None = None


class AdvisorMeta(_CamelModel):
    """Which adapter answered, so the UI can label demo answers and Gemini fallbacks honestly."""

    provider: Provider
    model: str | None = None
    language: str
    channel: Channel = "text"
    fallback_reason: str | None = None


class AdvisorResponse(_CamelModel):
    answer: str = Field(min_length=1, max_length=12000)
    summary: str = Field(min_length=1, max_length=1000)
    risks: list[RiskExplanation] = Field(default_factory=list)
    proposed_actions: list[ProposedAction] = Field(default_factory=list)
    meta: AdvisorMeta | None = None
