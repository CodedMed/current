package com.cashflowcopilot.health;

import com.cashflowcopilot.config.AppProperties;
import java.time.Instant;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Unauthenticated liveness check used by docker-compose and the README startup steps. */
@RestController
public class HealthController {

    private final AppProperties properties;

    public HealthController(AppProperties properties) {
        this.properties = properties;
    }

    @GetMapping("/health")
    public Health health() {
        return new Health("ok", "ledger-service", properties.demoMode(), Instant.now());
    }

    public record Health(String status, String service, boolean demoMode, Instant time) {}
}
