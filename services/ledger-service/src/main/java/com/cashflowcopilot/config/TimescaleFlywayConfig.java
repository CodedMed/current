package com.cashflowcopilot.config;

import com.cashflowcopilot.timescale.TimescaleSupport;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.flywaydb.core.api.Location;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.flyway.FlywayConfigurationCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Adds the Tiger Data migration stream only when the connected database can run it.
 *
 * <p>{@code db/migrations} is the portable baseline and runs everywhere. {@code db/timescale}
 * holds migrations that would be syntax errors on plain PostgreSQL — creating a continuous
 * aggregate cannot be wrapped in the {@code DO $$} guard V1 uses for the hypertable conversion,
 * because TimescaleDB refuses to create one inside a transaction block and a DO block is a
 * transaction. Selecting the location up front is what makes the guard unnecessary.
 *
 * <p>Schema history therefore differs legitimately between deployments: a Tiger Data database
 * records the 1001-series migrations, a plain PostgreSQL one never sees them.
 */
@Configuration
public class TimescaleFlywayConfig {

    static final String TIMESCALE_LOCATION = "classpath:db/timescale";

    private static final Logger log = LoggerFactory.getLogger(TimescaleFlywayConfig.class);

    @Bean
    public FlywayConfigurationCustomizer timescaleMigrationLocations(
            TimescaleSupport timescale, AppProperties properties) {
        return configuration -> {
            String version = timescale.version();
            if (version == null) {
                if (!properties.demoMode()) {
                    throw new IllegalStateException(
                            "DEMO_MODE=false but the configured database does not have the "
                                    + "timescaledb extension. Point DATABASE_URL at a Tiger Data "
                                    + "service, or run 'CREATE EXTENSION IF NOT EXISTS timescaledb;' "
                                    + "against it. Refusing to start on a silently degraded database.");
                }
                log.warn("timescaledb is not installed: continuing on plain PostgreSQL. "
                        + "Time-series analytics fall back to in-service aggregation.");
                return;
            }

            log.info("timescaledb {} detected: enabling the Tiger Data migration stream", version);
            List<String> locations = Arrays.stream(configuration.getLocations())
                    .map(Location::getDescriptor)
                    .collect(java.util.stream.Collectors.toCollection(ArrayList::new));
            locations.add(TIMESCALE_LOCATION);
            configuration.locations(locations.toArray(String[]::new));
        };
    }
}
