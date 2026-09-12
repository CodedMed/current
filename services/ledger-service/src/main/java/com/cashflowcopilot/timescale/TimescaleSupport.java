package com.cashflowcopilot.timescale;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Reports what the connected database actually supports.
 *
 * <p>Every probe below degrades to "no" rather than throwing. The {@code timescaledb_information}
 * views are version-dependent and simply absent on plain PostgreSQL, and this class is consulted
 * during startup before Flyway runs — a probe that threw would take the service down instead of
 * falling back to the portable path.
 */
@Component
public class TimescaleSupport {

    public static final String CASH_EVENTS_HYPERTABLE = "cash_events";
    public static final String CASH_DAILY_AGGREGATE = "cash_daily";

    private static final Logger log = LoggerFactory.getLogger(TimescaleSupport.class);

    private final DataSource dataSource;

    public TimescaleSupport(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    /** True when the timescaledb extension is installed on the connected database. */
    public boolean isAvailable() {
        return version() != null;
    }

    public String version() {
        return queryString("SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'");
    }

    /**
     * True when the database answers a trivial query. Every other probe here swallows failures
     * and returns "no", so without this check a database that is down looks identical to plain
     * PostgreSQL — and the health endpoint would report a dead database as a healthy portable one.
     */
    public boolean isReachable() {
        return queryString("SELECT 1") != null;
    }

    public TimescaleStatus status() {
        if (!isReachable()) {
            return TimescaleStatus.unreachable();
        }
        String version = version();
        if (version == null) {
            return TimescaleStatus.unavailable();
        }
        return new TimescaleStatus(
                true,
                true,
                version,
                isHypertable(CASH_EVENTS_HYPERTABLE),
                hasContinuousAggregate(CASH_DAILY_AGGREGATE),
                backgroundJobCount());
    }

    public boolean isHypertable(String table) {
        return count(
                "SELECT COUNT(*) FROM timescaledb_information.hypertables WHERE hypertable_name = ?",
                table) > 0;
    }

    public boolean hasContinuousAggregate(String viewName) {
        return count(
                "SELECT COUNT(*) FROM timescaledb_information.continuous_aggregates WHERE view_name = ?",
                viewName) > 0;
    }

    /**
     * Policies this service installed — the refresh job on {@code cash_daily} and the compression job
     * on {@code cash_events}. Timescale also runs housekeeping jobs of its own (telemetry, job-stat
     * retention) that are not attached to any table; counting those would report more policies than
     * the migrations actually created.
     */
    public int backgroundJobCount() {
        return count("SELECT COUNT(*) FROM timescaledb_information.jobs WHERE hypertable_name IS NOT NULL");
    }

    private String queryString(String sql) {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(sql);
                ResultSet rs = statement.executeQuery()) {
            return rs.next() ? rs.getString(1) : null;
        } catch (SQLException e) {
            log.debug("Timescale probe failed, treating as unavailable: {}", e.getMessage());
            return null;
        }
    }

    private int count(String sql, String... params) {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) {
                statement.setString(i + 1, params[i]);
            }
            try (ResultSet rs = statement.executeQuery()) {
                return rs.next() ? rs.getInt(1) : 0;
            }
        } catch (SQLException e) {
            log.debug("Timescale probe failed, treating as absent: {}", e.getMessage());
            return 0;
        }
    }
}
