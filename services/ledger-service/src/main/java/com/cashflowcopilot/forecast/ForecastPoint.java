package com.cashflowcopilot.forecast;

import com.cashflowcopilot.cashevent.CashEventStatus;
import com.cashflowcopilot.cashevent.Direction;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record ForecastPoint(
        Instant time,
        BigDecimal delta,
        BigDecimal projectedBalance,
        UUID cashEventId,
        String label,
        Direction direction,
        CashEventStatus status
) {}
