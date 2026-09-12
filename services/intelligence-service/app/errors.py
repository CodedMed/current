"""Shared error envelope: ``{"error": {"code": ..., "message": ..., "retryable": ...}}``."""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse

UNAUTHENTICATED = "UNAUTHENTICATED"
DOCUMENT_UNSUPPORTED = "DOCUMENT_UNSUPPORTED"
DOCUMENT_EXTRACTION_FAILED = "DOCUMENT_EXTRACTION_FAILED"
INVALID_FINANCIAL_DATA = "INVALID_FINANCIAL_DATA"
RISK_MODEL_UNAVAILABLE = "RISK_MODEL_UNAVAILABLE"
ADVISOR_UNAVAILABLE = "ADVISOR_UNAVAILABLE"
VOICE_UNAVAILABLE = "VOICE_UNAVAILABLE"

_STATUS_BY_CODE = {
    UNAUTHENTICATED: 401,
    DOCUMENT_UNSUPPORTED: 415,
    DOCUMENT_EXTRACTION_FAILED: 422,
    INVALID_FINANCIAL_DATA: 400,
    RISK_MODEL_UNAVAILABLE: 503,
    ADVISOR_UNAVAILABLE: 503,
    VOICE_UNAVAILABLE: 503,
}


class ApiError(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable

    @property
    def status_code(self) -> int:
        return _STATUS_BY_CODE.get(self.code, 500)

    def as_response(self) -> JSONResponse:
        return JSONResponse(
            status_code=self.status_code,
            content={
                "error": {
                    "code": self.code,
                    "message": self.message,
                    "retryable": self.retryable,
                }
            },
        )


async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return exc.as_response()
