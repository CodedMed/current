package com.cashflowcopilot.forecast;

import static org.assertj.core.api.Assertions.assertThat;

import com.cashflowcopilot.cashevent.CashEvent;
import com.cashflowcopilot.cashevent.CashEventSource;
import com.cashflowcopilot.cashevent.CashEventStatus;
import com.cashflowcopilot.cashevent.Direction;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class CashFlowForecastCalculatorTest {

    private static final Instant NOW = Instant.parse("2026-09-11T00:00:00Z");
    private static final int HORIZON_DAYS = 60;

    private final CashFlowForecastCalculator calculator = new CashFlowForecastCalculator();

    @Test
    void noFutureEventsLeavesBalanceUnchanged() {
        CashFlowForecast forecast = calculator.calculate(money("8000"), List.of(), HORIZON_DAYS, NOW);

        assertThat(forecast.currentCash()).isEqualByComparingTo("8000");
        assertThat(forecast.timeline()).isEmpty();
        assertThat(forecast.expectedInflow()).isEqualByComparingTo("0");
        assertThat(forecast.expectedOutflow()).isEqualByComparingTo("0");
        assertThat(forecast.hasGap()).isFalse();
    }

    @Test
    void onlyInflowsNeverProduceAGap() {
        CashFlowForecast forecast = calculator.calculate(
                money("1000"),
                List.of(event(2, "500", Direction.IN), event(9, "250", Direction.IN)),
                HORIZON_DAYS,
                NOW);

        assertThat(forecast.expectedInflow()).isEqualByComparingTo("750");
        assertThat(forecast.expectedOutflow()).isEqualByComparingTo("0");
        assertThat(last(forecast).projectedBalance()).isEqualByComparingTo("1750");
        assertThat(forecast.hasGap()).isFalse();
    }

    @Test
    void onlyOutflowsDrainTheBalance() {
        CashFlowForecast forecast = calculator.calculate(
                money("1000"),
                List.of(event(1, "400", Direction.OUT), event(5, "300", Direction.OUT)),
                HORIZON_DAYS,
                NOW);

        assertThat(forecast.expectedOutflow()).isEqualByComparingTo("700");
        assertThat(last(forecast).projectedBalance()).isEqualByComparingTo("300");
        assertThat(forecast.hasGap()).isFalse();
    }

    @Test
    void gapIsReportedWhenTheBalanceGoesNegative() {
        CashFlowForecast forecast = calculator.calculate(
                money("1000"),
                List.of(event(3, "1300", Direction.OUT)),
                HORIZON_DAYS,
                NOW);

        assertThat(forecast.hasGap()).isTrue();
        assertThat(forecast.firstGapDate()).isEqualTo(NOW.plus(3, ChronoUnit.DAYS));
        assertThat(forecast.firstGapAmount()).isEqualByComparingTo("300");
    }

    @Test
    void laterInflowDoesNotEraseTheFirstGap() {
        CashFlowForecast forecast = calculator.calculate(
                money("1000"),
                List.of(
                        event(3, "1300", Direction.OUT),
                        event(10, "9000", Direction.IN)),
                HORIZON_DAYS,
                NOW);

        assertThat(forecast.firstGapDate()).isEqualTo(NOW.plus(3, ChronoUnit.DAYS));
        assertThat(forecast.firstGapAmount()).isEqualByComparingTo("300");
        assertThat(last(forecast).projectedBalance()).isEqualByComparingTo("8700");
    }

    @Test
    void cancelledEventsAreIgnored() {
        CashEvent cancelled = new CashEvent(
                UUID.randomUUID(),
                UUID.randomUUID(),
                NOW.plus(2, ChronoUnit.DAYS),
                money("5000"),
                Direction.OUT,
                "rent",
                CashEventSource.MANUAL,
                null,
                "Cancelled rent",
                false,
                null,
                CashEventStatus.CANCELLED,
                Map.of());

        CashFlowForecast forecast = calculator.calculate(money("1000"), List.of(cancelled), HORIZON_DAYS, NOW);

        assertThat(forecast.timeline()).isEmpty();
        assertThat(forecast.hasGap()).isFalse();
    }

    @Test
    void multipleEventsOnTheSameDayAllApply() {
        CashFlowForecast forecast = calculator.calculate(
                money("1000"),
                List.of(
                        event(4, "600", Direction.OUT),
                        event(4, "300", Direction.OUT),
                        event(4, "100", Direction.IN)),
                HORIZON_DAYS,
                NOW);

        assertThat(forecast.timeline()).hasSize(3);
        assertThat(last(forecast).projectedBalance()).isEqualByComparingTo("200");
        assertThat(forecast.hasGap()).isFalse();
    }

    @Test
    void exactZeroIsNotAGap() {
        CashFlowForecast forecast = calculator.calculate(
                money("1000"),
                List.of(event(6, "1000", Direction.OUT)),
                HORIZON_DAYS,
                NOW);

        assertThat(last(forecast).projectedBalance()).isEqualByComparingTo("0");
        assertThat(forecast.hasGap()).isFalse();
    }

    @Test
    void eventsBeyondTheHorizonAreExcluded() {
        CashFlowForecast forecast = calculator.calculate(
                money("1000"),
                List.of(event(90, "5000", Direction.OUT)),
                HORIZON_DAYS,
                NOW);

        assertThat(forecast.timeline()).isEmpty();
        assertThat(forecast.hasGap()).isFalse();
    }

    @Test
    void overdueEventsDatedInThePastStillCount() {
        CashEvent overdue = new CashEvent(
                UUID.randomUUID(),
                UUID.randomUUID(),
                NOW.minus(12, ChronoUnit.DAYS),
                money("4000"),
                Direction.IN,
                "client_invoice",
                CashEventSource.MANUAL,
                null,
                "Client A",
                false,
                null,
                CashEventStatus.OVERDUE,
                Map.of());

        CashFlowForecast forecast = calculator.calculate(
                money("1000"), List.of(overdue, event(2, "2000", Direction.OUT)), HORIZON_DAYS, NOW);

        assertThat(forecast.timeline()).hasSize(2);
        assertThat(last(forecast).projectedBalance()).isEqualByComparingTo("3000");
        assertThat(forecast.hasGap()).isFalse();
    }

    private static ForecastPoint last(CashFlowForecast forecast) {
        return forecast.timeline().get(forecast.timeline().size() - 1);
    }

    private static BigDecimal money(String value) {
        return new BigDecimal(value);
    }

    private static CashEvent event(int dayOffset, String amount, Direction direction) {
        return new CashEvent(
                UUID.randomUUID(),
                UUID.randomUUID(),
                NOW.plus(dayOffset, ChronoUnit.DAYS),
                money(amount),
                direction,
                "test",
                CashEventSource.MANUAL,
                null,
                "test event",
                false,
                null,
                CashEventStatus.EXPECTED,
                Map.of());
    }
}
