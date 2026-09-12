package com.cashflowcopilot.persona;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.Locale;

public enum PersonaStatus {
    UNVERIFIED,
    PENDING,
    APPROVED,
    DECLINED,
    FAILED;

    /** Stored lower-case in {@code app_users.persona_status}. */
    public String storageValue() {
        return name().toLowerCase(Locale.ROOT);
    }

    public static PersonaStatus fromStorage(String value) {
        return value == null ? UNVERIFIED : PersonaStatus.valueOf(value.toUpperCase(Locale.ROOT));
    }

    /** Accepts either case on the wire, since the stored form is lower-case. */
    @JsonCreator
    public static PersonaStatus fromJson(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return fromStorage(value.trim());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Unknown persona status: " + value, e);
        }
    }
}
