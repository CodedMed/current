package com.cashflowcopilot.analytics;

import static org.assertj.core.api.Assertions.assertThat;

import com.cashflowcopilot.analytics.SpendAnalyticsRepository.DailyBucket;
import com.cashflowcopilot.cashevent.CashEvent;
import com.cashflowcopilot.cashevent.CashEventRepository;
import com.cashflowcopilot.cashevent.CashEventSource;
import com.cashflowcopilot.cashevent.CashEventStatus;
import com.cashflowcopilot.cashevent.Direction;
import com.cashflowcopilot.persona.PersonaStatus;
import com.cashflowcopilot.user.AppUser;
import com.cashflowcopilot.user.UserRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * The embedded demo PostgreSQL has no timescaledb extension, so the real continuous aggregate
 * cannot exist here. What can be verified — and is the thing most likely to be wrong — is that the
 * two SQL read paths bucket identically. A plain view carrying the same definition as the
 * continuous aggregate stands in for it, so {@code fromAggregate} runs against real columns.
 *
 * <p>TimescaleDB behaviour itself (chunking, refresh policies, compression) is unverified here and
 * has to be checked against a real Tiger Data service.
 */
@SpringBootTest(properties = {"app.demo-mode=true", "app.database-url="})
class SpendAnalyticsTest {

    private static final String CASH_DAILY_STAND_IN = """
            CREATE OR REPLACE VIEW cash_daily AS
            SELECT date_trunc('day', event_time) AS bucket,
                   user_id,
                   direction,
                   category,
                   SUM(amount) AS total_amount,
                   COUNT(*)    AS event_count
              FROM cash_events
             WHERE status = 'ACTUAL'
             GROUP BY 1, 2, 3, 4
            """;

    @Autowired JdbcClient jdbc;
    @Autowired SpendAnalyticsRepository repository;
    @Autowired SpendAnalyticsService service;
    @Autowired CashEventRepository cashEvents;
    @Autowired UserRepository users;

    private static boolean viewCreated;

    @BeforeAll
    static void reset() {
        viewCreated = false;
    }

    private void ensureStandInView() {
        if (!viewCreated) {
            jdbc.sql(CASH_DAILY_STAND_IN).update();
            viewCreated = true;
        }
    }

    private AppUser freshUser() {
        return users.insert(
                UUID.randomUUID(),
                "analytics-" + UUID.randomUUID(),
                null,
                "Analytics Test",
                PersonaStatus.APPROVED);
    }

    private void record(
            AppUser user, int daysAgo, String amount, Direction direction, String category, CashEventStatus status) {
        Instant when = LocalDate.now(ZoneOffset.UTC)
                .minusDays(daysAgo)
                .atStartOfDay(ZoneOffset.UTC)
                .plusHours(9)
                .toInstant();
        cashEvents.insert(new CashEvent(
                UUID.randomUUID(),
                user.id(),
                when,
                new BigDecimal(amount),
                direction,
                category,
                CashEventSource.MANUAL,
                null,
                "test",
                false,
                null,
                status,
                Map.of()));
    }

    private List<DailyBucket> window(AppUser user) {
        Instant to = Instant.now().truncatedTo(ChronoUnit.DAYS).plus(1, ChronoUnit.DAYS);
        Instant from = to.minus(120, ChronoUnit.DAYS);
        return repository.fromEvents(user.id(), from, to);
    }

    @Test
    void theAggregateAndTheRowScanBucketIdentically() {
        ensureStandInView();
        AppUser user = freshUser();
        record(user, 3, "120.00", Direction.OUT, "cloud_services", CashEventStatus.ACTUAL);
        record(user, 3, "80.00", Direction.OUT, "cloud_services", CashEventStatus.ACTUAL);
        record(user, 3, "500.00", Direction.IN, "client_payment", CashEventStatus.ACTUAL);
        record(user, 10, "45.50", Direction.OUT, "software", CashEventStatus.ACTUAL);

        Instant to = Instant.now().truncatedTo(ChronoUnit.DAYS).plus(1, ChronoUnit.DAYS);
        Instant from = to.minus(120, ChronoUnit.DAYS);

        assertThat(repository.fromAggregate(user.id(), from, to))
                .isEqualTo(repository.fromEvents(user.id(), from, to));
    }

    @Test
    void sameDayRowsInOneCategoryCollapseToOneBucket() {
        AppUser user = freshUser();
        record(user, 3, "120.00", Direction.OUT, "cloud_services", CashEventStatus.ACTUAL);
        record(user, 3, "80.00", Direction.OUT, "cloud_services", CashEventStatus.ACTUAL);

        List<DailyBucket> buckets = window(user);

        assertThat(buckets).hasSize(1);
        assertThat(buckets.get(0).total()).isEqualByComparingTo("200.00");
        assertThat(buckets.get(0).count()).isEqualTo(2);
    }

    @Test
    void unsettledObligationsAreNotCountedAsMoneyThatMoved() {
        AppUser user = freshUser();
        record(user, 2, "900.00", Direction.OUT, "rent", CashEventStatus.EXPECTED);
        record(user, 2, "40.00", Direction.OUT, "rent", CashEventStatus.OVERDUE);
        record(user, 2, "10.00", Direction.OUT, "rent", CashEventStatus.ACTUAL);

        List<DailyBucket> buckets = window(user);

        assertThat(buckets).hasSize(1);
        assertThat(buckets.get(0).total()).isEqualByComparingTo("10.00");
    }

    @Test
    void burnRateIsTheTrailingThirtyDayOutflowPerDay() {
        AppUser user = freshUser();
        record(user, 5, "300.00", Direction.OUT, "cloud_services", CashEventStatus.ACTUAL);

        SpendAnalytics analytics = service.analyse(user, 90);

        assertThat(analytics.burnRatePerDay()).isEqualByComparingTo("10.00");
    }

    @Test
    void spendOutsideTheTrailingWindowDoesNotRaiseTheBurnRate() {
        AppUser user = freshUser();
        record(user, 80, "3000.00", Direction.OUT, "cloud_services", CashEventStatus.ACTUAL);

        SpendAnalytics analytics = service.analyse(user, 90);

        assertThat(analytics.burnRatePerDay()).isEqualByComparingTo("0.00");
    }

    @Test
    void aUserBurningNothingHasNoRunwayFigureRatherThanZeroDays() {
        AppUser user = freshUser();
        record(user, 4, "500.00", Direction.IN, "client_payment", CashEventStatus.ACTUAL);

        SpendAnalytics analytics = service.analyse(user, 90);

        assertThat(analytics.burnRatePerDay()).isEqualByComparingTo("0.00");
        assertThat(analytics.runwayDays()).isNull();
    }

    @Test
    void theSeriesCoversEveryDayInTheWindowIncludingQuietOnes() {
        AppUser user = freshUser();
        record(user, 1, "25.00", Direction.OUT, "software", CashEventStatus.ACTUAL);

        SpendAnalytics analytics = service.analyse(user, 30);

        assertThat(analytics.series()).hasSize(30);
        assertThat(analytics.series())
                .extracting(SpendAnalytics.DailyPoint::outflow)
                .filteredOn(value -> value.signum() > 0)
                .hasSize(1);
    }

    @Test
    void aCategoryWithNoPriorSpendReportsNoPercentageChange() {
        AppUser user = freshUser();
        record(user, 2, "75.00", Direction.OUT, "new_vendor", CashEventStatus.ACTUAL);

        SpendAnalytics analytics = service.analyse(user, 90);

        assertThat(analytics.topMovers())
                .filteredOn(trend -> trend.category().equals("new_vendor"))
                .singleElement()
                .satisfies(trend -> {
                    assertThat(trend.previous()).isEqualByComparingTo("0.00");
                    assertThat(trend.changePct()).isNull();
                });
    }

    @Test
    void aWindowLargerThanTheMaximumIsClamped() {
        AppUser user = freshUser();

        assertThat(service.analyse(user, 99_999).windowDays())
                .isEqualTo(SpendAnalyticsService.MAX_WINDOW_DAYS);
        assertThat(service.analyse(user, null).windowDays())
                .isEqualTo(SpendAnalyticsService.DEFAULT_WINDOW_DAYS);
    }

    @Test
    void withoutTimescaleTheRowScanPathIsSelected() {
        assertThat(repository.activeSource()).isEqualTo(SpendAnalyticsRepository.Source.ROW_SCAN);
    }
}
