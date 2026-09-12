package com.cashflowcopilot.error;

import org.springframework.http.HttpStatus;

/** Stable error codes shared by every service and surfaced to the BFF unchanged. */
public enum ErrorCode {

    UNAUTHENTICATED(HttpStatus.UNAUTHORIZED, "Authentication is required."),
    PERSONA_NOT_VERIFIED(HttpStatus.FORBIDDEN, "Identity verification is required."),
    NESSIE_SYNC_FAILED(HttpStatus.BAD_GATEWAY, "Bank data could not be synchronised."),
    INVALID_FINANCIAL_DATA(HttpStatus.BAD_REQUEST, "The submitted financial data is invalid."),
    NOT_FOUND(HttpStatus.NOT_FOUND, "The requested resource does not exist."),
    NOT_IMPLEMENTED(HttpStatus.NOT_IMPLEMENTED, "This capability is not implemented yet."),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "Something went wrong.");

    private final HttpStatus status;
    private final String defaultMessage;

    ErrorCode(HttpStatus status, String defaultMessage) {
        this.status = status;
        this.defaultMessage = defaultMessage;
    }

    public HttpStatus status() {
        return status;
    }

    public String defaultMessage() {
        return defaultMessage;
    }
}
