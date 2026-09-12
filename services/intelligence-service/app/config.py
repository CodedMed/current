"""Runtime configuration read from the environment.

Every sponsor integration degrades to a mock adapter when its key is absent, so the service runs
with no credentials at all.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


def _flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    demo_mode: bool
    internal_service_token: str
    ledger_service_url: str

    ollama_base_url: str
    ollama_model: str

    gemini_api_key: str
    gemini_model: str

    elevenlabs_api_key: str
    elevenlabs_agent_id: str

    max_upload_bytes: int
    supported_languages: tuple[str, ...]

    @property
    def ollama_enabled(self) -> bool:
        return bool(self.ollama_model)

    @property
    def gemini_enabled(self) -> bool:
        return bool(self.gemini_api_key)

    @property
    def elevenlabs_enabled(self) -> bool:
        # A signed URL needs both the key and the agent to mint; one without the other is "off".
        return bool(self.elevenlabs_api_key and self.elevenlabs_agent_id)


@lru_cache
def get_settings() -> Settings:
    return Settings(
        demo_mode=_flag("DEMO_MODE", default=True),
        internal_service_token=os.getenv("INTERNAL_SERVICE_TOKEN", "local-dev-internal-token"),
        ledger_service_url=os.getenv("LEDGER_SERVICE_URL", "http://localhost:8080"),
        ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        ollama_model=os.getenv("OLLAMA_MODEL", ""),
        gemini_api_key=os.getenv("GEMINI_API_KEY", ""),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-3.6-flash"),
        elevenlabs_api_key=os.getenv("ELEVENLABS_API_KEY", ""),
        elevenlabs_agent_id=os.getenv("ELEVENLABS_AGENT_ID", ""),
        max_upload_bytes=int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024))),
        supported_languages=tuple(
            code.strip() for code in os.getenv("SUPPORTED_LANGUAGES", "en,es").split(",") if code.strip()
        ),
    )
