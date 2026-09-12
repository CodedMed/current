package com.cashflowcopilot.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app")
public record AppProperties(
        boolean demoMode,
        String internalServiceToken,
        String demoAuthSubject,
        int defaultHorizonDays,
        String databaseUrl,
        Nessie nessie
) {

    public record Nessie(String baseUrl, String apiKey, String demoCustomerId) {

        /** Live Nessie calls require a key; without one the mock adapter is used. */
        public boolean hasCredentials() {
            return apiKey != null && !apiKey.isBlank();
        }
    }
}
