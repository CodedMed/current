package com.cashflowcopilot.health;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.cashflowcopilot.config.AppProperties;
import com.cashflowcopilot.timescale.TimescaleStatus;
import com.cashflowcopilot.timescale.TimescaleSupport;
import org.junit.jupiter.api.Test;

/**
 * The Timescale probes deliberately degrade to "no" on any SQL failure. Without a separate
 * reachability check, a database that is down would be reported as healthy plain PostgreSQL —
 * which is exactly what happened when the Docker engine restarted underneath a running service.
 */
class HealthControllerTest {

    private static final AppProperties PROPERTIES = new AppProperties(
            true, "token", "demo-user", 60, "", new AppProperties.Nessie("", "", "demo"));

    @Test
    void aDatabaseThatDoesNotAnswerIsReportedAsUnreachableAndDegraded() {
        HealthController controller = new HealthController(PROPERTIES, stub(TimescaleStatus.unreachable()));

        HealthController.Health health = controller.health();

        assertEquals("degraded", health.status());
        assertEquals("unreachable", health.database().engine());
        assertFalse(health.database().reachable());
        assertNull(health.database().timescaleVersion());
        assertEquals("ROW_SCAN", health.database().analyticsSource());
    }

    @Test
    void plainPostgresIsReachableButNotTigerData() {
        HealthController controller = new HealthController(PROPERTIES, stub(TimescaleStatus.unavailable()));

        HealthController.Health health = controller.health();

        assertEquals("ok", health.status());
        assertEquals("postgresql", health.database().engine());
        assertTrue(health.database().reachable());
    }

    @Test
    void tigerDataWithTheAggregateServesAnalyticsFromIt() {
        HealthController controller = new HealthController(
                PROPERTIES, stub(new TimescaleStatus(true, true, "2.30.0", true, true, 2)));

        HealthController.Health health = controller.health();

        assertEquals("ok", health.status());
        assertEquals("tigerdata", health.database().engine());
        assertEquals("2.30.0", health.database().timescaleVersion());
        assertEquals(2, health.database().backgroundJobs());
        assertEquals("CONTINUOUS_AGGREGATE", health.database().analyticsSource());
    }

    private static TimescaleSupport stub(TimescaleStatus status) {
        return new TimescaleSupport(null) {
            @Override
            public TimescaleStatus status() {
                return status;
            }
        };
    }
}
