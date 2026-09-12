package com.cashflowcopilot.analytics;

import com.cashflowcopilot.analytics.SpendAnalytics.CategoryTotal;
import com.cashflowcopilot.analytics.SpendAnalytics.CategoryTrend;
import com.cashflowcopilot.analytics.SpendAnalytics.DailyPoint;
import com.cashflowcopilot.analytics.SpendAnalyticsRepository.DailyBucket;
import com.cashflowcopilot.cashevent.Direction;
import com.cashflowcopilot.forecast.CashFlowForecastService;
import com.cashflowcopilot.user.AppUser;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.stereotype.Service;

/**
 * Spending velocity derived from daily settled totals.
 *
 * <p>All arithmetic happens here, on buckets, so the Tiger Data and portable read paths cannot
 * diverge in anything except how those buckets were produced. Money stays in BigDecimal end to
 * end; no monetary value is ever converted to a double.
 */
@Service
public class SpendAnalyticsService {

    /** Burn rate and trend comparisons both use a 30-day window. */
    static final int TREND_WINDOW_DAYS = 30;

    public static final int DEFAULT_WINDOW_DAYS = 90;
    public static final int MAX_WINDOW_DAYS = 365;

    private static final int TOP_MOVERS = 5;

    private final SpendAnalyticsRepository repository;
    private final CashFlowForecastService forecastService;
    private final Clock clock;

    public SpendAnalyticsService(
            SpendAnalyticsRepository repository,
            CashFlowForecastService forecastService,
            Clock clock) {
        this.repository = repository;
        this.forecastService = forecastService;
        this.clock = clock;
    }

    public SpendAnalytics analyse(AppUser user, Integer requestedWindowDays) {
        int windowDays = clampWindow(requestedWindowDays);
        LocalDate today = LocalDate.ofInstant(Instant.now(clock), ZoneOffset.UTC);

        // Trend needs the 30 days before the current 30 even when the caller asked for less.
        int lookbackDays = Math.max(windowDays, TREND_WINDOW_DAYS * 2);
        List<DailyBucket> buckets = repository.dailyBuckets(
                user.id(), startOfDay(today.minusDays(lookbackDays - 1L)), startOfDay(today.plusDays(1)));

        LocalDate windowStart = today.minusDays(windowDays - 1L);
        LocalDate currentPeriodStart = today.minusDays(TREND_WINDOW_DAYS - 1L);
        LocalDate previousPeriodStart = today.minusDays(TREND_WINDOW_DAYS * 2L - 1);

        BigDecimal currentCash = forecastService.forecast(user, null).currentCash();
        BigDecimal burnRate = burnRatePerDay(buckets, currentPeriodStart, today);

        return new SpendAnalytics(
                windowDays,
                series(buckets, windowStart, today),
                categoryTotals(buckets, windowStart, today),
                burnRate,
                runwayDays(currentCash, burnRate),
                topMovers(buckets, previousPeriodStart, currentPeriodStart, today),
                repository.activeSource().name());
    }

    private int clampWindow(Integer requested) {
        if (requested == null || requested < 1) {
            return DEFAULT_WINDOW_DAYS;
        }
        return Math.min(requested, MAX_WINDOW_DAYS);
    }

    private Instant startOfDay(LocalDate date) {
        return date.atStartOfDay(ZoneOffset.UTC).toInstant();
    }

    /** Every day in the window, including days with no activity. */
    private List<DailyPoint> series(List<DailyBucket> buckets, LocalDate from, LocalDate to) {
        Map<LocalDate, BigDecimal[]> byDay = new TreeMap<>();
        for (LocalDate day = from; !day.isAfter(to); day = day.plusDays(1)) {
            byDay.put(day, new BigDecimal[] {BigDecimal.ZERO, BigDecimal.ZERO});
        }
        for (DailyBucket bucket : inRange(buckets, from, to)) {
            BigDecimal[] totals = byDay.get(bucket.day());
            int index = bucket.direction() == Direction.IN ? 0 : 1;
            totals[index] = totals[index].add(bucket.total());
        }
        List<DailyPoint> points = new ArrayList<>(byDay.size());
        byDay.forEach((day, totals) -> points.add(new DailyPoint(day, totals[0], totals[1])));
        return points;
    }

    private List<CategoryTotal> categoryTotals(List<DailyBucket> buckets, LocalDate from, LocalDate to) {
        Map<String, BigDecimal> totals = new LinkedHashMap<>();
        Map<String, Long> counts = new LinkedHashMap<>();
        for (DailyBucket bucket : inRange(buckets, from, to)) {
            if (bucket.direction() != Direction.OUT) {
                continue;
            }
            totals.merge(bucket.category(), bucket.total(), BigDecimal::add);
            counts.merge(bucket.category(), bucket.count(), Long::sum);
        }
        return totals.entrySet().stream()
                .map(entry -> new CategoryTotal(
                        entry.getKey(), entry.getValue(), counts.getOrDefault(entry.getKey(), 0L)))
                .sorted(Comparator.comparing(CategoryTotal::outflow).reversed())
                .toList();
    }

    private BigDecimal burnRatePerDay(List<DailyBucket> buckets, LocalDate from, LocalDate to) {
        BigDecimal outflow = BigDecimal.ZERO;
        for (DailyBucket bucket : inRange(buckets, from, to)) {
            if (bucket.direction() == Direction.OUT) {
                outflow = outflow.add(bucket.total());
            }
        }
        return outflow.divide(BigDecimal.valueOf(TREND_WINDOW_DAYS), 2, RoundingMode.HALF_UP);
    }

    /**
     * Days of cash left at the current burn.
     *
     * <p>Null when nothing is being burned — there is no finite runway to report, and returning a
     * large number or a zero would both read as a fact the data does not support.
     */
    private Integer runwayDays(BigDecimal currentCash, BigDecimal burnRatePerDay) {
        if (burnRatePerDay.signum() <= 0) {
            return null;
        }
        if (currentCash == null || currentCash.signum() <= 0) {
            return 0;
        }
        BigDecimal days = currentCash.divide(burnRatePerDay, 0, RoundingMode.FLOOR);
        return days.compareTo(BigDecimal.valueOf(Integer.MAX_VALUE)) >= 0
                ? Integer.MAX_VALUE
                : days.intValueExact();
    }

    private List<CategoryTrend> topMovers(
            List<DailyBucket> buckets, LocalDate previousStart, LocalDate currentStart, LocalDate today) {
        Map<String, BigDecimal> current = outflowByCategory(buckets, currentStart, today);
        Map<String, BigDecimal> previous =
                outflowByCategory(buckets, previousStart, currentStart.minusDays(1));

        Map<String, BigDecimal> categories = new LinkedHashMap<>(current);
        previous.forEach(categories::putIfAbsent);

        return categories.keySet().stream()
                .map(category -> {
                    BigDecimal now = current.getOrDefault(category, BigDecimal.ZERO);
                    BigDecimal before = previous.getOrDefault(category, BigDecimal.ZERO);
                    return new CategoryTrend(category, now, before, changePct(now, before));
                })
                .sorted(Comparator.comparing(
                        (CategoryTrend trend) -> trend.current().subtract(trend.previous()).abs())
                        .reversed())
                .limit(TOP_MOVERS)
                .toList();
    }

    private Map<String, BigDecimal> outflowByCategory(
            List<DailyBucket> buckets, LocalDate from, LocalDate to) {
        Map<String, BigDecimal> totals = new LinkedHashMap<>();
        for (DailyBucket bucket : inRange(buckets, from, to)) {
            if (bucket.direction() == Direction.OUT) {
                totals.merge(bucket.category(), bucket.total(), BigDecimal::add);
            }
        }
        return totals;
    }

    /** Null when there was no prior spend: a percentage increase from zero does not exist. */
    private Double changePct(BigDecimal current, BigDecimal previous) {
        if (previous.signum() == 0) {
            return null;
        }
        return current.subtract(previous)
                .divide(previous, 4, RoundingMode.HALF_UP)
                .multiply(BigDecimal.valueOf(100))
                .doubleValue();
    }

    private List<DailyBucket> inRange(List<DailyBucket> buckets, LocalDate from, LocalDate to) {
        return buckets.stream()
                .filter(bucket -> !bucket.day().isBefore(from) && !bucket.day().isAfter(to))
                .toList();
    }

    /** Exposed for the dashboard and advisor context, which need the headline figures only. */
    public Headline headline(AppUser user) {
        SpendAnalytics analytics = analyse(user, TREND_WINDOW_DAYS);
        return new Headline(analytics.burnRatePerDay(), analytics.runwayDays(), analytics.topMovers());
    }

    public record Headline(
            BigDecimal burnRatePerDay, Integer runwayDays, List<CategoryTrend> topMovers) {}
}
