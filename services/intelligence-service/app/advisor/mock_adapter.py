"""Deterministic advisor output for demo mode and for the Gemini fallback.

Every number it quotes comes from the context computed by the ledger service. Like the real
adapter, it never calculates a balance, a gap or a risk score of its own: it selects, ranks and
compares the figures it was given, and it says so when the context does not cover a question.

The reply is routed by the *intent* of the question (available cash, upcoming expenses, the
projected gap, overdue receivables, priorities, affordability, invoice risk, what-if on a late
payment) so a demo conversation feels grounded rather than canned, in English or Spanish, for the
text and the spoken surface alike.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal

from app.advisor.schemas import (
    AdvisorContext,
    AdvisorRequest,
    AdvisorResponse,
    ExpectedReceivable,
    ObligationSummary,
    ProposedAction,
    RiskExplanation,
)

Intent = str

# Ordered: the first matching intent wins, so the more specific phrasings come first.
_INTENTS: list[tuple[Intent, list[str]]] = [
    ("late_payment", [r"paid late", r"pays? late", r"late payment", r"pay(s|ing)? me late", r"pagan? tarde", r"pague tarde", r"con retraso", r"se retras"]),
    ("overdue", [r"overdue", r"follow.?up", r"\bchase\b", r"past due", r"late invoice", r"vencid", r"atrasad", r"seguimiento", r"reclamar"]),
    ("afford", [r"afford", r"enough (cash|money)", r"can i (pay|cover)", r"able to pay", r"puedo pagar", r"alcanza", r"suficiente", r"permitirme"]),
    ("gap", [r"\bgap\b", r"shortfall", r"run out", r"below zero", r"negative", r"going down", r"drop", r"decreas", r"declin", r"brecha", r"d[eé]ficit", r"negativ", r"bajando", r"quedar[eé]? sin", r"cae"]),
    ("expenses", [r"expense", r"\bbills?\b", r"obligation", r"\bowe\b", r"outflow", r"going out", r"payments? due", r"upcoming payment", r"gasto", r"obligaci", r"salida", r"por pagar", r"pagos? pendiente"]),
    ("inflows", [r"coming in", r"inflow", r"receivable", r"owed to me", r"expected payment", r"who owes", r"incoming", r"cobros?", r"entradas?", r"por cobrar", r"ingresos?", r"me deben"]),
    ("risk", [r"\brisk", r"suspicious", r"unusual", r"anomal", r"flagged", r"fraud", r"riesgo", r"sospechos", r"inusual", r"an[oó]mal"]),
    ("tasks", [r"\btasks?\b", r"to.?do", r"tareas?", r"pendientes"]),
    ("prioritize", [r"priorit", r"what should i do", r"\bfirst\b", r"this week", r"focus", r"next step", r"qu[eé] (debo|deber[ií]a|hago)", r"primero", r"esta semana", r"enfocar"]),
    ("cash", [r"how much (cash|money)", r"available cash", r"cash (do i have|on hand|available|position)", r"balance", r"cu[aá]nto (dinero|efectivo)", r"efectivo disponible", r"saldo", r"disponible"]),
    ("overview", [r"how (is|are) (my|the) business", r"doing", r"overview", r"situation", r"summary", r"health", r"c[oó]mo (va|est[aá])", r"situaci[oó]n", r"resumen", r"salud"]),
]

_MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
_MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def classify(message: str) -> Intent:
    text = message.lower()
    for intent, patterns in _INTENTS:
        if any(re.search(pattern, text) for pattern in patterns):
            return intent
    return "overview"


def _money(value: Decimal | float | int | None, es: bool) -> str:
    if value is None:
        return "un importe desconocido" if es else "an unknown amount"
    amount = Decimal(str(value))
    sign = "-" if amount < 0 else ""
    return f"{sign}${abs(amount):,.0f}"


def _day(value: date | None, es: bool, spoken: bool) -> str:
    if value is None:
        return "fecha desconocida" if es else "an unknown date"
    if not spoken:
        return value.isoformat()
    if es:
        return f"{value.day} de {_MONTHS_ES[value.month - 1]}"
    return f"{_MONTHS_EN[value.month - 1]} {value.day}"


def _parse_amount(message: str) -> Decimal | None:
    """A dollar figure the user typed ("$2,500", "2500 dollars"), or None."""
    match = re.search(r"\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)|([0-9][0-9,]*(?:\.[0-9]+)?)\s?(?:dollars|usd|d[oó]lares)", message, re.IGNORECASE)
    if not match:
        return None
    raw = match.group(1) or match.group(2)
    try:
        return Decimal(raw.replace(",", ""))
    except ArithmeticError:
        return None


class MockAdvisor:
    provider = "mock"

    async def advise(self, request: AdvisorRequest) -> AdvisorResponse:
        es = request.language == "es"
        spoken = request.channel == "voice"
        intent = classify(request.message)
        builder = _Builder(request.context, es=es, spoken=spoken)
        answer, summary, risks, actions = getattr(builder, intent)(request.message)
        if spoken:
            answer = builder.spoken_answer(answer, summary, actions)
        return AdvisorResponse(answer=answer, summary=summary, risks=risks, proposed_actions=actions)


class _Builder:
    """One method per intent. Each returns (answer, summary, risks, proposedActions)."""

    def __init__(self, context: AdvisorContext, *, es: bool, spoken: bool) -> None:
        self.c = context
        self.es = es
        self.spoken = spoken

    # ── shared pieces ──────────────────────────────────────────────────────────

    def money(self, value) -> str:
        return _money(value, self.es)

    def day(self, value: date | None) -> str:
        return _day(value, self.es, self.spoken)

    def gap_date(self) -> date | None:
        return self.c.first_gap_date.date() if self.c.first_gap_date else None

    def t(self, en: str, es: str) -> str:
        return es if self.es else en

    def position_sentence(self) -> str:
        c = self.c
        return self.t(
            f"You currently hold {self.money(c.current_cash)}. Over the next 30 days the ledger expects "
            f"{self.money(c.expected_inflow30d)} to come in and {self.money(c.expected_outflow30d)} to go out.",
            f"Actualmente tienes {self.money(c.current_cash)}. En los próximos 30 días el libro mayor espera "
            f"{self.money(c.expected_inflow30d)} de entradas y {self.money(c.expected_outflow30d)} de salidas.",
        )

    def gap_sentence(self) -> str:
        c = self.c
        gap = self.gap_date()
        if gap is None:
            return self.t(
                "No cash gap is projected inside the forecast horizon.",
                "No se proyecta ninguna brecha de efectivo dentro del horizonte de pronóstico.",
            )
        when = self.day(gap)
        days = f" ({c.days_until_gap} days from now)" if c.days_until_gap is not None and not self.es else (f" (dentro de {c.days_until_gap} días)" if c.days_until_gap is not None else "")
        return self.t(
            f"Projection: your balance is expected to fall {self.money(c.first_gap_amount)} below zero on {when}{days}, "
            "a cash gap — the day the projected balance would go negative.",
            f"Proyección: se espera que tu saldo caiga {self.money(c.first_gap_amount)} por debajo de cero el {when}{days}, "
            "una brecha de efectivo — el día en que el saldo proyectado se volvería negativo.",
        )

    def gap_summary(self) -> str:
        c = self.c
        gap = self.gap_date()
        if gap is None:
            return self.t(
                "No cash gap is projected inside the forecast horizon.",
                "No se proyecta ninguna brecha de efectivo en el horizonte.",
            )
        return self.t(
            f"Projected shortfall of {self.money(c.first_gap_amount)} on {self.day(gap)}.",
            f"Déficit proyectado de {self.money(c.first_gap_amount)} el {self.day(gap)}.",
        )

    def gap_risk(self) -> RiskExplanation | None:
        c = self.c
        gap = self.gap_date()
        if gap is None:
            return None
        return RiskExplanation(
            title=self.t("Upcoming cash gap", "Brecha de efectivo próxima"),
            severity="HIGH",
            explanation=self.t(
                f"Expected outflows of {self.money(c.expected_outflow30d)} over the next 30 days exceed expected inflows of "
                f"{self.money(c.expected_inflow30d)}, which takes the projected balance below zero on {self.day(gap)}.",
                f"Las salidas esperadas de {self.money(c.expected_outflow30d)} en los próximos 30 días superan las entradas esperadas de "
                f"{self.money(c.expected_inflow30d)}, lo que lleva el saldo proyectado por debajo de cero el {self.day(gap)}.",
            ),
        )

    def invoice_risks(self) -> list[RiskExplanation]:
        risks = []
        for risk in self.c.invoice_risks:
            score = risk.risk_score or 0
            risks.append(
                RiskExplanation(
                    title=self.t(f"Unusual invoice from {risk.vendor_label}", f"Factura inusual de {risk.vendor_label}"),
                    severity="HIGH" if score >= 0.7 else "MEDIUM",
                    explanation="; ".join(risk.reasons)
                    or self.t("This invoice differs from the vendor's history.", "Esta factura difiere del historial del proveedor."),
                )
            )
        return risks

    def ranked_overdue(self):
        # Largest amount first; days overdue breaks ties. Both figures come from the ledger.
        return sorted(self.c.overdue_receivables, key=lambda r: (-(r.amount or 0), -(r.days_overdue or 0)))

    def overdue_actions(self) -> list[ProposedAction]:
        actions = []
        for receivable in self.ranked_overdue():
            actions.append(
                ProposedAction(
                    title=self.t(f"Follow up with {receivable.counterparty_label}", f"Hacer seguimiento a {receivable.counterparty_label}"),
                    rationale=self.t(
                        f"The {self.money(receivable.amount)} invoice is {receivable.days_overdue} days overdue and collecting it is "
                        "the fastest way to improve liquidity.",
                        f"La factura de {self.money(receivable.amount)} lleva {receivable.days_overdue} días vencida y cobrarla es la forma "
                        "más rápida de mejorar la liquidez.",
                    ),
                    priority="HIGH",
                    estimated_impact=receivable.amount,
                )
            )
        return actions

    def largest_obligation_before_gap(self) -> ObligationSummary | None:
        gap = self.gap_date()
        candidates = [
            o for o in self.c.upcoming_obligations
            if o.amount is not None and (gap is None or o.due_date is None or o.due_date <= gap)
        ]
        return max(candidates, key=lambda o: o.amount, default=None)

    def gap_action(self) -> ProposedAction | None:
        gap = self.gap_date()
        if gap is None:
            return None
        obligation = self.largest_obligation_before_gap()
        if obligation is not None:
            return ProposedAction(
                title=self.t(
                    f"Set aside cash for {obligation.label} ({self.money(obligation.amount)})",
                    f"Reservar efectivo para {obligation.label} ({self.money(obligation.amount)})",
                ),
                rationale=self.t(
                    f"It is the largest outflow due before the projected gap on {self.day(gap)}"
                    + (f", due {self.day(obligation.due_date)}." if obligation.due_date else "."),
                    f"Es la salida más grande que vence antes de la brecha proyectada del {self.day(gap)}"
                    + (f", con vencimiento el {self.day(obligation.due_date)}." if obligation.due_date else "."),
                ),
                priority="MEDIUM",
                due_date=(obligation.due_date or gap) - timedelta(days=7),
            )
        return ProposedAction(
            title=self.t("Prepare for the projected cash gap", "Prepararse para la brecha de efectivo proyectada"),
            rationale=self.t(
                f"The projection shows a {self.money(self.c.first_gap_amount)} shortfall on {self.day(gap)}; bringing an "
                "expected payment forward or delaying a discretionary outflow would close it.",
                f"La proyección muestra un déficit de {self.money(self.c.first_gap_amount)} el {self.day(gap)}; adelantar un "
                "cobro esperado o retrasar una salida discrecional lo cerraría.",
            ),
            priority="MEDIUM",
            due_date=gap - timedelta(days=7),
        )

    def review_actions(self) -> list[ProposedAction]:
        actions = []
        for risk in self.c.invoice_risks:
            actions.append(
                ProposedAction(
                    title=self.t(f"Review the flagged invoice from {risk.vendor_label}", f"Revisar la factura marcada de {risk.vendor_label}"),
                    rationale=self.t(
                        f"The risk engine scored it {risk.risk_score:.2f} ({risk.severity}): " + ("; ".join(risk.reasons) or "it differs from the vendor's history") + ". Confirm it with the vendor before paying.",
                        f"El motor de riesgo le dio {risk.risk_score:.2f} ({risk.severity}): " + ("; ".join(risk.reasons) or "difiere del historial del proveedor") + ". Confírmala con el proveedor antes de pagar.",
                    ) if risk.risk_score is not None else self.t("The risk engine flagged it; confirm it with the vendor before paying.", "El motor de riesgo la marcó; confírmala con el proveedor antes de pagar."),
                    priority="HIGH" if (risk.risk_score or 0) >= 0.7 else "MEDIUM",
                )
            )
        return actions

    def ranked_actions(self) -> list[ProposedAction]:
        actions = self.overdue_actions()
        gap = self.gap_action()
        if gap is not None:
            actions.append(gap)
        actions.extend(self.review_actions())
        return actions

    def numbered(self, actions: list[ProposedAction]) -> list[str]:
        if not actions:
            return []
        lines = [self.t("Recommended, in priority order (each needs your approval before it becomes a task):", "Recomendaciones en orden de prioridad (cada una requiere tu aprobación antes de convertirse en tarea):")]
        lines.extend(f"{index}. {action.title} — {action.rationale}" for index, action in enumerate(actions, 1))
        return lines

    def spoken_answer(self, answer: str, summary: str, actions: list[ProposedAction]) -> str:
        """A short spoken version: the lead fact, the headline, one recommendation."""
        first = answer.split("\n")[0]
        parts = [first]
        if summary not in first:
            parts.append(summary)
        if actions:
            top = actions[0]
            parts.append(self.t(f"My first recommendation: {top.title}. {top.rationale}", f"Mi primera recomendación: {top.title}. {top.rationale}"))
        return " ".join(parts)

    def not_in_context(self, what_en: str, what_es: str) -> str:
        return self.t(
            f"The ledger context I was given does not include {what_en}, so I will not guess at it.",
            f"El contexto del libro mayor que recibí no incluye {what_es}, así que no voy a adivinarlo.",
        )

    # ── intents ────────────────────────────────────────────────────────────────

    def overview(self, _message: str):
        c = self.c
        lines = [self.position_sentence(), self.gap_sentence()]
        overdue = self.ranked_overdue()
        if overdue:
            lines.append(self.t(
                f"{len(overdue)} receivable{'s are' if len(overdue) > 1 else ' is'} overdue, led by {overdue[0].counterparty_label} ({self.money(overdue[0].amount)}, {overdue[0].days_overdue} days late).",
                f"{len(overdue)} cobro{'s están' if len(overdue) > 1 else ' está'} vencido{'s' if len(overdue) > 1 else ''}, encabezado por {overdue[0].counterparty_label} ({self.money(overdue[0].amount)}, {overdue[0].days_overdue} días de retraso).",
            ))
        if c.invoice_risks:
            lines.append(self.t(
                f"{len(c.invoice_risks)} vendor invoice{'s look' if len(c.invoice_risks) > 1 else ' looks'} unusual and should be checked before paying.",
                f"{len(c.invoice_risks)} factura{'s de proveedor parecen inusuales' if len(c.invoice_risks) > 1 else ' de proveedor parece inusual'} y conviene revisarla{'s' if len(c.invoice_risks) > 1 else ''} antes de pagar.",
            ))
        actions = self.ranked_actions()
        lines.extend(self.numbered(actions))
        risks = [r for r in [self.gap_risk()] if r] + self.invoice_risks()
        return "\n".join(lines), self.gap_summary(), risks, actions

    def cash(self, _message: str):
        c = self.c
        lines = [self.t(
            f"Fact: you have {self.money(c.current_cash)} available right now, straight from your bank balance.",
            f"Hecho: tienes {self.money(c.current_cash)} disponibles ahora mismo, directamente de tu saldo bancario.",
        )]
        if c.net30d is not None:
            lines.append(self.t(
                f"Projection: with {self.money(c.expected_inflow30d)} expected in and {self.money(c.expected_outflow30d)} expected out, the next 30 days net to {self.money(c.net30d)}.",
                f"Proyección: con {self.money(c.expected_inflow30d)} de entradas y {self.money(c.expected_outflow30d)} de salidas esperadas, los próximos 30 días dejan un neto de {self.money(c.net30d)}.",
            ))
        if c.projected_low_point and c.projected_low_point.balance is not None:
            lines.append(self.t(
                f"The lowest projected balance inside the horizon is {self.money(c.projected_low_point.balance)} on {self.day(c.projected_low_point.date)}.",
                f"El saldo proyectado más bajo dentro del horizonte es {self.money(c.projected_low_point.balance)} el {self.day(c.projected_low_point.date)}.",
            ))
        lines.append(self.gap_sentence())
        summary = self.t(f"{self.money(c.current_cash)} available today.", f"{self.money(c.current_cash)} disponibles hoy.")
        risks = [r for r in [self.gap_risk()] if r]
        actions = [a for a in [self.gap_action()] if a]
        return "\n".join(lines), summary, risks, actions

    def expenses(self, _message: str):
        c = self.c
        obligations = sorted([o for o in c.upcoming_obligations if o.amount is not None], key=lambda o: -o.amount)
        if not obligations:
            lines = [self.not_in_context("a list of upcoming obligations", "una lista de obligaciones próximas"),
                     self.t(f"In total, {self.money(c.expected_outflow30d)} is expected to go out over the next 30 days.", f"En total, se esperan salidas de {self.money(c.expected_outflow30d)} en los próximos 30 días.")]
            return "\n".join(lines), self.t(f"{self.money(c.expected_outflow30d)} expected out over 30 days.", f"{self.money(c.expected_outflow30d)} de salidas esperadas en 30 días."), [], []
        lines = [self.t(
            f"Your largest upcoming outflows, biggest first (expected total over 30 days: {self.money(c.expected_outflow30d)}):",
            f"Tus mayores salidas próximas, de mayor a menor (total esperado en 30 días: {self.money(c.expected_outflow30d)}):",
        )]
        for index, o in enumerate(obligations[:5], 1):
            overdue = o.days_until_due is not None and o.days_until_due < 0
            when = (self.t("overdue", "vencido") if overdue else self.t(f"due {self.day(o.due_date)}", f"vence el {self.day(o.due_date)}"))
            lines.append(f"{index}. {o.label} — {self.money(o.amount)}, {when}" + (f" ({o.category})" if o.category and not self.spoken else ""))
        lines.append(self.gap_sentence())
        top = obligations[0]
        summary = self.t(
            f"Largest upcoming expense: {top.label}, {self.money(top.amount)} due {self.day(top.due_date)}.",
            f"Mayor gasto próximo: {top.label}, {self.money(top.amount)} con vencimiento el {self.day(top.due_date)}.",
        )
        risks = [r for r in [self.gap_risk()] if r]
        actions = [a for a in [self.gap_action()] if a]
        return "\n".join(lines), summary, risks, actions

    def inflows(self, _message: str):
        c = self.c
        lines = [self.t(
            f"Expected inflows over the next 30 days total {self.money(c.expected_inflow30d)}"
            + (f", and {self.money(c.expected_inflow60d)} over 60 days." if c.expected_inflow60d is not None else "."),
            f"Las entradas esperadas en los próximos 30 días suman {self.money(c.expected_inflow30d)}"
            + (f", y {self.money(c.expected_inflow60d)} en 60 días." if c.expected_inflow60d is not None else "."),
        )]
        for r in self.ranked_overdue():
            lines.append(self.t(
                f"Overdue: {r.counterparty_label} owes {self.money(r.amount)}, {r.days_overdue} days late.",
                f"Vencido: {r.counterparty_label} debe {self.money(r.amount)}, {r.days_overdue} días de retraso.",
            ))
        for r in c.expected_receivables[:5]:
            lines.append(self.t(
                f"Expected: {r.counterparty_label} — {self.money(r.amount)} due {self.day(r.due_date)}.",
                f"Esperado: {r.counterparty_label} — {self.money(r.amount)} con vencimiento el {self.day(r.due_date)}.",
            ))
        if not c.overdue_receivables and not c.expected_receivables:
            lines.append(self.not_in_context("individual receivables", "cobros individuales"))
        summary = self.t(f"{self.money(c.expected_inflow30d)} expected in over the next 30 days.", f"{self.money(c.expected_inflow30d)} de entradas esperadas en los próximos 30 días.")
        actions = self.overdue_actions()
        return "\n".join(lines), summary, [], actions

    def gap(self, _message: str):
        c = self.c
        lines = [self.gap_sentence()]
        if self.gap_date() is not None:
            lines.append(self.t(
                f"Why: over the next 30 days expected outflows ({self.money(c.expected_outflow30d)}) exceed expected inflows ({self.money(c.expected_inflow30d)}), so the balance trends down from {self.money(c.current_cash)} today.",
                f"Por qué: en los próximos 30 días las salidas esperadas ({self.money(c.expected_outflow30d)}) superan las entradas esperadas ({self.money(c.expected_inflow30d)}), así que el saldo baja desde los {self.money(c.current_cash)} de hoy.",
            ))
            obligation = self.largest_obligation_before_gap()
            if obligation is not None:
                lines.append(self.t(
                    f"The largest outflow before the gap is {obligation.label} ({self.money(obligation.amount)}, due {self.day(obligation.due_date)}).",
                    f"La salida más grande antes de la brecha es {obligation.label} ({self.money(obligation.amount)}, vence el {self.day(obligation.due_date)}).",
                ))
            overdue = self.ranked_overdue()
            if overdue:
                lead = overdue[0]
                lines.append(self.t(
                    f"The overdue {self.money(lead.amount)} from {lead.counterparty_label} is larger than the {self.money(c.first_gap_amount)} shortfall, so collecting it before {self.day(self.gap_date())} would cover the gap.",
                    f"Los {self.money(lead.amount)} vencidos de {lead.counterparty_label} superan el déficit de {self.money(c.first_gap_amount)}, así que cobrarlos antes del {self.day(self.gap_date())} cubriría la brecha.",
                ) if (lead.amount or 0) >= (c.first_gap_amount or 0) else self.t(
                    f"Collecting the overdue {self.money(lead.amount)} from {lead.counterparty_label} would narrow the {self.money(c.first_gap_amount)} shortfall but not close it on its own.",
                    f"Cobrar los {self.money(lead.amount)} vencidos de {lead.counterparty_label} reduciría el déficit de {self.money(c.first_gap_amount)}, pero no lo cerraría por sí solo.",
                ))
            if c.projected_low_point and c.projected_low_point.balance is not None:
                lines.append(self.t(
                    f"The low point of the projection is {self.money(c.projected_low_point.balance)} on {self.day(c.projected_low_point.date)}.",
                    f"El punto más bajo de la proyección es {self.money(c.projected_low_point.balance)} el {self.day(c.projected_low_point.date)}.",
                ))
        else:
            lines.append(self.position_sentence())
        actions = self.ranked_actions()
        lines.extend(self.numbered(actions))
        risks = [r for r in [self.gap_risk()] if r]
        return "\n".join(lines), self.gap_summary(), risks, actions

    def overdue(self, _message: str):
        ranked = self.ranked_overdue()
        if not ranked:
            lines = [self.t("Fact: no receivables are overdue in the ledger right now.", "Hecho: ahora mismo no hay cobros vencidos en el libro mayor.")]
            return "\n".join(lines), self.t("No overdue receivables.", "Sin cobros vencidos."), [], []
        lead = ranked[0]
        lines = [self.t(
            f"Follow up with {lead.counterparty_label} first: {self.money(lead.amount)} is {lead.days_overdue} days overdue, the largest overdue amount.",
            f"Haz seguimiento primero a {lead.counterparty_label}: {self.money(lead.amount)} lleva {lead.days_overdue} días vencido, el mayor importe vencido.",
        )]
        for r in ranked[1:]:
            lines.append(self.t(f"Then {r.counterparty_label}: {self.money(r.amount)}, {r.days_overdue} days overdue.", f"Luego {r.counterparty_label}: {self.money(r.amount)}, {r.days_overdue} días vencido."))
        if self.gap_date() is not None:
            lines.append(self.t(
                f"Collecting it matters because the projection shows a {self.money(self.c.first_gap_amount)} gap on {self.day(self.gap_date())}.",
                f"Cobrarlo importa porque la proyección muestra una brecha de {self.money(self.c.first_gap_amount)} el {self.day(self.gap_date())}.",
            ))
        summary = self.t(
            f"Chase {lead.counterparty_label} first: {self.money(lead.amount)}, {lead.days_overdue} days overdue.",
            f"Reclama primero a {lead.counterparty_label}: {self.money(lead.amount)}, {lead.days_overdue} días vencido.",
        )
        risks = [r for r in [self.gap_risk()] if r]
        return "\n".join(lines), summary, risks, self.overdue_actions()

    def late_payment(self, message: str):
        c = self.c
        # Which receivable? The one named in the question, else the soonest expected, else the largest overdue.
        named = next((r for r in c.expected_receivables + c.overdue_receivables if r.counterparty_label and r.counterparty_label.lower() in message.lower()), None)
        target = named or (c.expected_receivables[0] if c.expected_receivables else None)
        if target is None and c.overdue_receivables:
            target = self.ranked_overdue()[0]
        if target is None:
            return self.not_in_context("individual receivables to run this scenario on", "cobros individuales para evaluar este escenario"), self.gap_summary(), [], []
        due = target.due_date if isinstance(target, ExpectedReceivable) else None
        lines = [self.t(
            f"Scenario: the ledger counts {self.money(target.amount)} from {target.counterparty_label}" + (f" on {self.day(due)}" if due else "") + " as expected income.",
            f"Escenario: el libro mayor cuenta {self.money(target.amount)} de {target.counterparty_label}" + (f" el {self.day(due)}" if due else "") + " como ingreso esperado.",
        )]
        gap = self.gap_date()
        if gap is not None:
            lines.append(self.t(
                f"If it arrives after {self.day(gap)}, the projected {self.money(c.first_gap_amount)} shortfall on that date grows by up to {self.money(target.amount)}; if it arrives before, it shrinks by the same amount.",
                f"Si llega después del {self.day(gap)}, el déficit proyectado de {self.money(c.first_gap_amount)} en esa fecha aumenta hasta {self.money(target.amount)}; si llega antes, se reduce en la misma cantidad.",
            ))
        else:
            lines.append(self.t(
                f"No gap is projected today; a delay would lower the projected balance around the due date by {self.money(target.amount)} until the money lands.",
                f"Hoy no se proyecta ninguna brecha; un retraso bajaría el saldo proyectado alrededor del vencimiento en {self.money(target.amount)} hasta que llegue el dinero.",
            ))
        lines.append(self.t("I have not recomputed the forecast; the ledger does that when the invoice's date actually changes.", "No he recalculado el pronóstico; el libro mayor lo hace cuando la fecha de la factura cambia de verdad."))
        action = ProposedAction(
            title=self.t(f"Confirm the payment date with {target.counterparty_label}", f"Confirmar la fecha de pago con {target.counterparty_label}"),
            rationale=self.t(f"{self.money(target.amount)} is expected" + (f" on {self.day(due)}" if due else "") + "; a firm date keeps the projection honest.", f"Se esperan {self.money(target.amount)}" + (f" el {self.day(due)}" if due else "") + "; una fecha firme mantiene la proyección fiable."),
            priority="MEDIUM",
            due_date=(due - timedelta(days=5)) if due else None,
            estimated_impact=target.amount,
        )
        summary = self.t(f"A late {self.money(target.amount)} from {target.counterparty_label} widens the projected gap by up to that amount.", f"Un retraso de {self.money(target.amount)} de {target.counterparty_label} amplía la brecha proyectada hasta esa cantidad.") if gap else self.t(f"A late {self.money(target.amount)} lowers the projected balance temporarily.", f"Un retraso de {self.money(target.amount)} baja temporalmente el saldo proyectado.")
        risks = [r for r in [self.gap_risk()] if r]
        return "\n".join(lines), summary, risks, [action]

    def afford(self, message: str):
        c = self.c
        amount = _parse_amount(message)
        low = c.projected_low_point.balance if c.projected_low_point else None
        lines = [self.position_sentence(), self.gap_sentence()]
        if low is not None:
            lines.append(self.t(f"The lowest projected balance inside the horizon is {self.money(low)} on {self.day(c.projected_low_point.date)}.", f"El saldo proyectado más bajo dentro del horizonte es {self.money(low)} el {self.day(c.projected_low_point.date)}."))
        if amount is not None and low is not None:
            if low >= amount:
                lines.append(self.t(f"An extra {self.money(amount)} stays within that projected low point, so it looks affordable without new action — as a projection, not a guarantee.", f"Un gasto adicional de {self.money(amount)} cabe dentro de ese punto bajo proyectado, así que parece asumible sin nuevas acciones — como proyección, no como garantía."))
                summary = self.t(f"{self.money(amount)} fits inside the projected low point of {self.money(low)}.", f"{self.money(amount)} cabe dentro del punto bajo proyectado de {self.money(low)}.")
            else:
                lines.append(self.t(f"An extra {self.money(amount)} is more than that projected low point, so paying it without collecting more cash first would push the balance below zero.", f"Un gasto adicional de {self.money(amount)} supera ese punto bajo proyectado, así que pagarlo sin cobrar más efectivo antes llevaría el saldo por debajo de cero."))
                summary = self.t(f"{self.money(amount)} exceeds the projected low point of {self.money(low)}; collect first.", f"{self.money(amount)} supera el punto bajo proyectado de {self.money(low)}; cobra primero.")
        elif self.gap_date() is not None:
            lines.append(self.t("Because a gap is already projected, any new outflow before that date needs matching inflow first.", "Como ya se proyecta una brecha, cualquier salida nueva antes de esa fecha necesita primero una entrada equivalente."))
            summary = self.gap_summary()
        else:
            summary = self.t("No gap is projected; expected inflows cover expected outflows.", "No se proyecta ninguna brecha; las entradas esperadas cubren las salidas.")
            if amount is None:
                lines.append(self.t("Tell me the amount and I will compare it with the projected low point.", "Dime el importe y lo compararé con el punto bajo proyectado."))
        actions = self.ranked_actions()
        lines.extend(self.numbered(actions[:2]))
        risks = [r for r in [self.gap_risk()] if r]
        return "\n".join(lines), summary, risks, actions[:2]

    def risk(self, _message: str):
        risks = self.invoice_risks()
        if not risks:
            return self.t("Fact: the risk engine has not flagged any vendor invoice as unusual.", "Hecho: el motor de riesgo no ha marcado ninguna factura de proveedor como inusual."), self.t("No unusual invoices flagged.", "Sin facturas inusuales marcadas."), [], []
        lines = [self.t(f"{len(risks)} vendor invoice{'s are' if len(risks) > 1 else ' is'} flagged as unusual:", f"{len(risks)} factura{'s de proveedor están marcadas' if len(risks) > 1 else ' de proveedor está marcada'} como inusual{'es' if len(risks) > 1 else ''}:")]
        for r in self.c.invoice_risks:
            lines.append(self.t(f"- {r.vendor_label}: score {r.risk_score:.2f} ({r.severity}) — " + ("; ".join(r.reasons) or "differs from history"), f"- {r.vendor_label}: puntuación {r.risk_score:.2f} ({r.severity}) — " + ("; ".join(r.reasons) or "difiere del historial")) if r.risk_score is not None else f"- {r.vendor_label}")
        lines.append(self.t("A risk score says how unusual the invoice is for this vendor, not that it is fraud. Confirm the details with the vendor before paying.", "La puntuación de riesgo indica lo inusual que es la factura para este proveedor, no que sea fraude. Confirma los detalles con el proveedor antes de pagar."))
        top = self.c.invoice_risks[0]
        summary = self.t(f"Check the {top.vendor_label} invoice before paying it.", f"Revisa la factura de {top.vendor_label} antes de pagarla.")
        return "\n".join(lines), summary, risks, self.review_actions()

    def tasks(self, _message: str):
        todos = self.c.open_todos
        if not todos:
            return self.t("Fact: there are no open financial tasks.", "Hecho: no hay tareas financieras abiertas."), self.t("No open tasks.", "Sin tareas abiertas."), [], self.ranked_actions()[:2]
        lines = [self.t("Your open financial tasks:", "Tus tareas financieras abiertas:")]
        for todo in todos:
            lines.append(f"- {todo.title} ({todo.status}, {todo.priority}" + (f", {self.day(todo.due_date)}" if todo.due_date else "") + ")")
        actions = self.ranked_actions()[:2]
        lines.extend(self.numbered(actions))
        summary = self.t(f"{len(todos)} open task{'s' if len(todos) > 1 else ''}.", f"{len(todos)} tarea{'s abiertas' if len(todos) > 1 else ' abierta'}.")
        return "\n".join(lines), summary, [], actions

    def prioritize(self, _message: str):
        lines = [self.position_sentence(), self.gap_sentence()]
        actions = self.ranked_actions()
        if not actions:
            lines.append(self.t("Nothing in the ledger needs urgent action this week.", "Nada en el libro mayor requiere acción urgente esta semana."))
        lines.extend(self.numbered(actions))
        risks = [r for r in [self.gap_risk()] if r] + self.invoice_risks()
        return "\n".join(lines), self.gap_summary(), risks, actions
