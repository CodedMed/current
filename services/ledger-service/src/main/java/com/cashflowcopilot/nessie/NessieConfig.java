package com.cashflowcopilot.nessie;

import com.cashflowcopilot.config.AppProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

@Configuration
public class NessieConfig {

    private static final Logger log = LoggerFactory.getLogger(NessieConfig.class);

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }

    /**
     * A key selects the live client; nothing else does. DEMO_MODE governs the auth and
     * verification bypasses only, so live bank data can be shown alongside the demo sign-in.
     * No key means the demo fixture: the skeleton must run without sponsor credentials.
     */
    @Bean
    @Primary
    public NessieClient nessieClient(AppProperties properties, ObjectMapper objectMapper, Clock clock) {
        if (properties.nessie().hasCredentials()) {
            log.info("Using live Nessie client");
            return new RealNessieClient(properties.nessie());
        }
        log.info("Using MockNessieClient (no NESSIE_API_KEY)");
        return new MockNessieClient(objectMapper, clock);
    }

    /** Always available: the fixture client that serves the demo customer whatever the key situation. */
    @Bean("demoNessieClient")
    public MockNessieClient demoNessieClient(ObjectMapper objectMapper, Clock clock) {
        return new MockNessieClient(objectMapper, clock);
    }
}
