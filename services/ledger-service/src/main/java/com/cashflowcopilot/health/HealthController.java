package com.cashflowcopilot.health;

import com.cashflowcopilot.config.AppProperties;
import com.cashflowcopilot.timescale.TimescaleStatus;
import com.cashflowcopilot.timescale.TimescaleSupport;
import java.time.Instant;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Unauthenticated liveness check used by docker-compose and the README startup steps. */
@RestController
public class HealthController {

    private final AppProperties properties;
    private final TimescaleSupport timescale;

    public HealthController(AppProperties properties, TimescaleSupport timescale) {
        this.properties = properties;
        this.timescale = timescale;
    }

    @GetMapping("/health")
    public Health health() {
        TimescaleStatus status = timescale.status();
        return new Health(
                status.reachable() ? "ok" : "degraded",
                "ledger-service",
                properties.demoMode(),
                Instant.now(),
                new Database(
                        engineOf(status),
                        status.reachable(),
                        status.version(),
                        status.cashEventsHypertable(),
                        status.cashDailyAggregate(),
                        status.backgroundJobs(),
                        status.aggregateReadable() ? "CONTINUOUS_AGGREGATE" : "ROW_SCAN"));
    }

    private static String engineOf(TimescaleStatus status) {
        if (!status.reachable()) {
            return "unreachable";
        }
        return status.available() ? "tigerdata" : "postgresql";
    }

    public record Health(
            String status, String service, boolean demoMode, Instant time, Database database) {}

    /**
     * Which database capabilities are actually live.
     *
     * <p>The hypertable conversion in V1 silently no-ops on plain PostgreSQL, so without this
     * nobody can tell which mode a running service is in.
     */
    public record Database(
            String engine,
            boolean reachable,
            String timescaleVersion,
            boolean cashEventsHypertable,
            boolean cashDailyAggregate,
            int backgroundJobs,
            String analyticsSource) {}
}
