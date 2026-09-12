package com.cashflowcopilot.analytics;

import com.cashflowcopilot.cashevent.Direction;
import com.cashflowcopilot.timescale.TimescaleSupport;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * Daily settled totals, read from the Tiger Data continuous aggregate when one exists and from the
 * hypertable directly when it does not.
 *
 * <p>Both paths bucket by UTC day and both restrict to {@code status = 'ACTUAL'}, matching the
 * {@code cash_daily} view definition exactly. That restriction is not a detail: {@code cash_events}
 * also holds EXPECTED and OVERDUE obligations, and counting those as money that moved would inflate
 * the burn rate and shorten the runway. Every derived figure is computed from these buckets in
 * {@link SpendAnalyticsService}, so the two paths can only differ if the bucketing differs.
 *
 * <p>All queries are user-scoped and parameterized.
 */
@Repository
public class SpendAnalyticsRepository {

    private final JdbcClient jdbcClient;
    private final TimescaleSupport timescale;

    public SpendAnalyticsRepository(JdbcClient jdbcClient, TimescaleSupport timescale) {
        this.jdbcClient = jdbcClient;
        this.timescale = timescale;
    }

    public Source activeSource() {
        return timescale.status().aggregateReadable() ? Source.CONTINUOUS_AGGREGATE : Source.ROW_SCAN;
    }

    public List<DailyBucket> dailyBuckets(UUID userId, Instant from, Instant to) {
        return activeSource() == Source.CONTINUOUS_AGGREGATE
                ? fromAggregate(userId, from, to)
                : fromEvents(userId, from, to);
    }

    /** Reads the pre-materialised Tiger Data rollup. */
    public List<DailyBucket> fromAggregate(UUID userId, Instant from, Instant to) {
        return jdbcClient.sql("""
                        SELECT bucket::date AS day, direction, category, total_amount, event_count
                          FROM cash_daily
                         WHERE user_id = ?
                           AND bucket >= ?
                           AND bucket < ?
                         ORDER BY day ASC
                        """)
                .params(userId, Timestamp.from(from), Timestamp.from(to))
                .query(this::mapRow)
                .list();
    }

    /** Portable fallback. Same buckets, computed on read. */
    public List<DailyBucket> fromEvents(UUID userId, Instant from, Instant to) {
        return jdbcClient.sql("""
                        SELECT date_trunc('day', event_time)::date AS day,
                               direction,
                               category,
                               SUM(amount) AS total_amount,
                               COUNT(*)    AS event_count
                          FROM cash_events
                         WHERE user_id = ?
                           AND status = 'ACTUAL'
                           AND event_time >= ?
                           AND event_time < ?
                         GROUP BY 1, 2, 3
                         ORDER BY day ASC
                        """)
                .params(userId, Timestamp.from(from), Timestamp.from(to))
                .query(this::mapRow)
                .list();
    }

    private DailyBucket mapRow(ResultSet rs, int rowNum) throws SQLException {
        return new DailyBucket(
                rs.getObject("day", LocalDate.class),
                Direction.valueOf(rs.getString("direction")),
                rs.getString("category"),
                rs.getBigDecimal("total_amount"),
                rs.getLong("event_count"));
    }

    /** One day of settled money for one direction and category. */
    public record DailyBucket(
            LocalDate day, Direction direction, String category, BigDecimal total, long count) {}

    public enum Source {
        CONTINUOUS_AGGREGATE,
        ROW_SCAN
    }
}
