package com.cashflowcopilot.analytics;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * Spending velocity over a window of settled transactions.
 *
 * <p>{@code runwayDays} is null rather than a sentinel when the business is not burning cash —
 * "no runway figure" and "zero days of runway" are opposite meanings and must not share a value.
 */
public record SpendAnalytics(
        int windowDays,
        List<DailyPoint> series,
        List<CategoryTotal> categories,
        BigDecimal burnRatePerDay,
        Integer runwayDays,
        List<CategoryTrend> topMovers,
        String source
) {

    public record DailyPoint(LocalDate date, BigDecimal inflow, BigDecimal outflow) {}

    public record CategoryTotal(String category, BigDecimal outflow, long transactions) {}

    /**
     * Outflow for a category in the recent window against the window before it.
     *
     * <p>{@code changePct} is null when the category had no prior spend — there is no percentage
     * increase from zero, and reporting one would be a fabricated number.
     */
    public record CategoryTrend(
            String category, BigDecimal current, BigDecimal previous, Double changePct) {}
}
