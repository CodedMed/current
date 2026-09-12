package com.cashflowcopilot.nessie;

import com.cashflowcopilot.config.AppProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class NessieConfig {

    private static final Logger log = LoggerFactory.getLogger(NessieConfig.class);

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }

    /** No API key means the demo fixture: the skeleton must run without sponsor credentials. */
    @Bean
    public NessieClient nessieClient(AppProperties properties, ObjectMapper objectMapper, Clock clock) {
        if (properties.nessie().hasCredentials() && !properties.demoMode()) {
            log.info("Using live Nessie client");
            return new RealNessieClient(properties.nessie());
        }
        log.info("Using MockNessieClient (no NESSIE_API_KEY or DEMO_MODE=true)");
        return new MockNessieClient(objectMapper, clock);
    }
}
