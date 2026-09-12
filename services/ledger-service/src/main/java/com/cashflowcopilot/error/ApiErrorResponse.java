package com.cashflowcopilot.error;

/** Stable error envelope: {@code {"error": {"code": "...", "message": "..."}}}. */
public record ApiErrorResponse(Body error) {

    public record Body(String code, String message) {}

    public static ApiErrorResponse of(ErrorCode code, String message) {
        return new ApiErrorResponse(new Body(code.name(), message));
    }
}
