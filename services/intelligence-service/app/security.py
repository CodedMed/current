"""Internal service trust boundary, mirroring the ledger service's filter.

Only the Next.js BFF holds the shared token; the browser never calls this service directly.
"""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, Header

from app.config import Settings, get_settings
from app.errors import UNAUTHENTICATED, ApiError


def require_internal_caller(
    x_internal_service_token: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> None:
    if not x_internal_service_token or not hmac.compare_digest(
        x_internal_service_token, settings.internal_service_token
    ):
        raise ApiError(UNAUTHENTICATED, "Missing or invalid internal service token.")


InternalCaller = Depends(require_internal_caller)
