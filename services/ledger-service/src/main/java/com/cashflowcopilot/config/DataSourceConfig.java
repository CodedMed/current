package com.cashflowcopilot.config;

import com.zaxxer.hikari.HikariDataSource;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Builds the DataSource from the monorepo-wide {@code DATABASE_URL}
 * ({@code postgresql://user:pass@host:port/db?params}), which is not a JDBC URL.
 *
 * <p>When no database is configured and demo mode is on, a local PostgreSQL is started so the
 * service boots with zero infrastructure. The same Flyway migrations run against it verbatim.
 */
@Configuration
public class DataSourceConfig {

    private static final Logger log = LoggerFactory.getLogger(DataSourceConfig.class);

    @Bean
    public DataSource dataSource(AppProperties properties, EmbeddedPostgresHolder embeddedPostgres) {
        String databaseUrl = properties.databaseUrl();
        if (databaseUrl == null || databaseUrl.isBlank()) {
            return embeddedPostgres.dataSource();
        }
        JdbcCoordinates coordinates = JdbcCoordinates.parse(databaseUrl);
        log.info("Connecting to configured database {}", coordinates.jdbcUrl());
        HikariDataSource dataSource = DataSourceBuilder.create()
                .type(HikariDataSource.class)
                .url(coordinates.jdbcUrl())
                .username(coordinates.username())
                .password(coordinates.password())
                .build();
        // Hikari waits 30 s by default before giving up on a connection. With the database down
        // that turns every /health probe into a 30 s stall, which is worse than the outage itself.
        // Five seconds covers a TLS handshake to hosted Tiger Data with room to spare.
        dataSource.setConnectionTimeout(5_000);
        dataSource.setValidationTimeout(2_000);
        return dataSource;
    }

    @Bean(destroyMethod = "close")
    public EmbeddedPostgresHolder embeddedPostgresHolder(AppProperties properties) {
        return new EmbeddedPostgresHolder(properties);
    }

    /** Owns the lifecycle of the demo-only embedded PostgreSQL instance. */
    public static class EmbeddedPostgresHolder implements AutoCloseable {

        private final AppProperties properties;
        private EmbeddedPostgres instance;

        EmbeddedPostgresHolder(AppProperties properties) {
            this.properties = properties;
        }

        synchronized DataSource dataSource() {
            if (!properties.demoMode()) {
                throw new IllegalStateException(
                        "DATABASE_URL is required when DEMO_MODE=false. "
                                + "Set DATABASE_URL to a PostgreSQL/Tiger Data connection string.");
            }
            if (instance == null) {
                log.warn("DATABASE_URL is not set and DEMO_MODE=true: starting an embedded "
                        + "PostgreSQL for this demo run. Data is discarded on shutdown.");
                try {
                    instance = EmbeddedPostgres.builder().start();
                } catch (IOException e) {
                    throw new IllegalStateException(
                            "Could not start the embedded demo database. Set DATABASE_URL to use "
                                    + "a real PostgreSQL/Tiger Data instance instead.", e);
                }
            }
            return instance.getPostgresDatabase();
        }

        @Override
        public synchronized void close() throws IOException {
            if (instance != null) {
                instance.close();
                instance = null;
            }
        }
    }

    record JdbcCoordinates(String jdbcUrl, String username, String password) {

        static JdbcCoordinates parse(String databaseUrl) {
            String trimmed = databaseUrl.trim();
            if (trimmed.startsWith("jdbc:")) {
                return new JdbcCoordinates(trimmed, null, null);
            }
            URI uri;
            try {
                uri = new URI(trimmed);
            } catch (URISyntaxException e) {
                throw new IllegalArgumentException("DATABASE_URL is not a valid URL", e);
            }
            String username = null;
            String password = null;
            String userInfo = uri.getUserInfo();
            if (userInfo != null) {
                int separator = userInfo.indexOf(':');
                username = separator < 0 ? userInfo : userInfo.substring(0, separator);
                password = separator < 0 ? null : userInfo.substring(separator + 1);
            }
            StringBuilder jdbcUrl = new StringBuilder("jdbc:postgresql://");
            jdbcUrl.append(uri.getHost());
            if (uri.getPort() > 0) {
                jdbcUrl.append(':').append(uri.getPort());
            }
            jdbcUrl.append(uri.getPath() == null || uri.getPath().isBlank() ? "/postgres" : uri.getPath());
            if (uri.getQuery() != null && !uri.getQuery().isBlank()) {
                jdbcUrl.append('?').append(uri.getQuery());
            }
            return new JdbcCoordinates(jdbcUrl.toString(), username, password);
        }
    }
}
