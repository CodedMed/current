"""Shared fixtures for the advisor tests: a Settings builder and the seeded demo context."""

from __future__ import annotations

from app.advisor.schemas import AdvisorRequest
from app.config import Settings


def settings(**overrides) -> Settings:
    base = dict(
        demo_mode=True,
        internal_service_token="token",
        ledger_service_url="http://localhost:8080",
        ollama_base_url="http://localhost:11434",
        ollama_model="",
        gemini_api_key="",
        gemini_model="gemini-3.6-flash",
        elevenlabs_api_key="",
        elevenlabs_agent_id="",
        max_upload_bytes=10_000_000,
        supported_languages=("en", "es"),
    )
    base.update(overrides)
    return Settings(**base)


def demo_context() -> dict:
    """The allowlisted context the ledger service produces for the seeded demo business."""
    return {
        "asOfDate": "2026-09-12",
        "horizonDays": 60,
        "currentCash": 8000,
        "expectedInflow30d": 6500,
        "expectedOutflow30d": 13500,
        "net30d": -7000,
        "expectedInflow60d": 25000,
        "expectedOutflow60d": 16500,
        "net60d": 8500,
        "firstGapDate": "2026-10-09T12:00:00Z",
        "firstGapAmount": 1200,
        "daysUntilGap": 27,
        "projectedLowPoint": {"date": "2026-10-09", "balance": -1200, "label": "Quarterly estimated tax payment"},
        "projectedEndBalance": 16500,
        "overdueReceivables": [{"counterpartyLabel": "Client A", "amount": 4000, "daysOverdue": 12}],
        "expectedReceivables": [
            {"counterpartyLabel": "Client D", "amount": 2500, "dueDate": "2026-10-01", "daysUntilDue": 19},
            {"counterpartyLabel": "Client B", "amount": 9000, "dueDate": "2026-10-20", "daysUntilDue": 38},
        ],
        "upcomingObligations": [
            {"label": "Harbor Property Group", "category": "rent", "amount": 2200, "dueDate": "2026-09-14", "daysUntilDue": 2, "status": "EXPECTED"},
            {"label": "Quarterly estimated tax payment", "category": "tax", "amount": 4500, "dueDate": "2026-10-09", "daysUntilDue": 27, "status": "EXPECTED"},
        ],
        "invoiceRisks": [
            {
                "invoiceId": "6f1c2f6e-0000-4000-8000-000000000001",
                "vendorLabel": "Cloud Provider",
                "riskScore": 0.87,
                "severity": "HIGH",
                "reasons": ["Amount is 30% above the vendor's previous charge", "Payment details changed since this vendor's last invoice"],
            }
        ],
        "openTodos": [{"id": "6f1c2f6e-0000-4000-8000-000000000002", "title": "Send payment reminder to Client A", "status": "IN_PROGRESS", "priority": "HIGH", "dueDate": "2026-09-13"}],
    }


def request(message: str, *, language: str = "en", channel: str = "text", history: list | None = None, context: dict | None = None) -> AdvisorRequest:
    return AdvisorRequest.model_validate(
        {
            "message": message,
            "language": language,
            "channel": channel,
            "history": history or [],
            "context": demo_context() if context is None else context,
        }
    )
