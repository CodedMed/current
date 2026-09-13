from __future__ import annotations

import logging

from fastapi import FastAPI

from app.api import advisor, documents, i18n, risk, voice
from app.config import get_settings
from app.errors import ApiError, api_error_handler
from app.risk.isolation_forest import ml_available
from app.voice.service import VOICE_CLIENT_TOOL

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Cash Flow Copilot — intelligence service",
    description=(
        "Private document understanding, invoice anomaly detection and CFO reasoning. "
        "Holds no authoritative financial state: structured results are returned to the BFF, "
        "which persists them through the ledger service."
    ),
    version="0.1.0",
)

app.add_exception_handler(ApiError, api_error_handler)
app.include_router(documents.router)
app.include_router(risk.router)
app.include_router(advisor.router)
app.include_router(voice.router)
app.include_router(i18n.router)


@app.get("/health", tags=["health"])
def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "service": "intelligence-service",
        "demoMode": settings.demo_mode,
        "adapters": {
            "localExtractor": "ollama" if settings.ollama_enabled else "mock",
            "advisor": "gemini" if settings.gemini_enabled else "mock",
            "voice": "elevenlabs" if settings.elevenlabs_enabled else "text-fallback",
            "riskModel": "rules+isolation-forest" if ml_available() else "rules-only",
        },
        "voiceClientTool": VOICE_CLIENT_TOOL,
    }
