package com.cashflowcopilot.cashevent;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/** Normalized money movement. Every ingest path converges on this record. */
public record CashEvent(
        UUID id,
        UUID userId,
        Instant eventTime,
        BigDecimal amount,
        Direction direction,
        String category,
        CashEventSource source,
        String sourceRecordId,
        String description,
        boolean recurring,
        Double confidence,
        CashEventStatus status,
        Map<String, Object> metadata
) {

    /** Signed contribution to a running balance. */
    public BigDecimal signedAmount() {
        return direction == Direction.IN ? amount : amount.negate();
    }
}
