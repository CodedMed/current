package com.cashflowcopilot.forecast;

import com.cashflowcopilot.cashevent.CashEvent;
import com.cashflowcopilot.cashevent.CashEventStatus;
import com.cashflowcopilot.cashevent.Direction;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Deterministic cash-flow projection. Pure arithmetic over {@link BigDecimal}; no model ever
 * produces these numbers.
 *
 * <p>The first gap is the first moment the running balance crosses below zero, not the deepest
 * later deficit, and a later inflow never erases it.
 */
@Component
public class CashFlowForecastCalculator {

    private static final int MONEY_SCALE = 2;

    private static final Comparator<CashEvent> CHRONOLOGICAL = Comparator
            .comparing(CashEvent::eventTime)
            .thenComparing(CashEvent::id);

    public CashFlowForecast calculate(
            BigDecimal currentCash, List<CashEvent> events, int horizonDays, Instant generatedAt) {

        BigDecimal balance = scaled(currentCash);
        Instant horizonEnd = generatedAt.plus(horizonDays, ChronoUnit.DAYS);

        List<CashEvent> relevant = events.stream()
                .filter(event -> event.status() != CashEventStatus.CANCELLED)
                .filter(event -> !event.eventTime().isAfter(horizonEnd))
                .sorted(CHRONOLOGICAL)
                .toList();

        List<ForecastPoint> timeline = new ArrayList<>(relevant.size());
        List<UUID> contributingEventIds = new ArrayList<>(relevant.size());
        BigDecimal expectedInflow = zero();
        BigDecimal expectedOutflow = zero();
        Instant firstGapDate = null;
        BigDecimal firstGapAmount = null;

        for (CashEvent event : relevant) {
            BigDecimal amount = scaled(event.amount());
            if (event.direction() == Direction.IN) {
                expectedInflow = expectedInflow.add(amount);
                balance = balance.add(amount);
            } else {
                expectedOutflow = expectedOutflow.add(amount);
                balance = balance.subtract(amount);
            }

            timeline.add(new ForecastPoint(
                    event.eventTime(),
                    event.direction() == Direction.IN ? amount : amount.negate(),
                    balance,
                    event.id(),
                    event.description(),
                    event.direction(),
                    event.status()));
            contributingEventIds.add(event.id());

            if (firstGapDate == null && balance.compareTo(BigDecimal.ZERO) < 0) {
                firstGapDate = event.eventTime();
                firstGapAmount = balance.abs();
            }
        }

        return new CashFlowForecast(
                scaled(currentCash),
                expectedInflow,
                expectedOutflow,
                List.copyOf(timeline),
                firstGapDate,
                firstGapAmount,
                List.copyOf(contributingEventIds),
                horizonDays,
                generatedAt);
    }

    private static BigDecimal scaled(BigDecimal value) {
        return (value == null ? BigDecimal.ZERO : value).setScale(MONEY_SCALE, RoundingMode.HALF_UP);
    }

    private static BigDecimal zero() {
        return BigDecimal.ZERO.setScale(MONEY_SCALE, RoundingMode.UNNECESSARY);
    }
}
