package com.cashflowcopilot.forecast;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record CashFlowForecast(
        BigDecimal currentCash,
        BigDecimal expectedInflow,
        BigDecimal expectedOutflow,
        List<ForecastPoint> timeline,
        Instant firstGapDate,
        BigDecimal firstGapAmount,
        List<UUID> contributingEventIds,
        int horizonDays,
        Instant generatedAt
) {

    public boolean hasGap() {
        return firstGapDate != null;
    }
}
