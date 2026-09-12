package com.cashflowcopilot.nessie;

import static org.assertj.core.api.Assertions.assertThat;

import com.cashflowcopilot.config.AppProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import org.junit.jupiter.api.Test;

/**
 * The live client is chosen by the presence of a key and nothing else. Tying it to DEMO_MODE made
 * "show real bank data" and "skip Persona with the dev bypass" mutually exclusive, which is
 * exactly the combination a demo needs.
 */
class NessieConfigTest {

    private static AppProperties properties(boolean demoMode, String apiKey) {
        return new AppProperties(demoMode, "token", "demo-user", 60, "",
                new AppProperties.Nessie("https://api.nessieisreal.com", apiKey, "demo-customer-001"));
    }

    private static NessieClient select(AppProperties properties) {
        return new NessieConfig().nessieClient(properties, new ObjectMapper(), Clock.systemUTC());
    }

    @Test
    void aKeySelectsTheLiveClientEvenInDemoMode() {
        assertThat(select(properties(true, "key"))).isInstanceOf(RealNessieClient.class);
        assertThat(select(properties(false, "key"))).isInstanceOf(RealNessieClient.class);
    }

    @Test
    void noKeyMeansTheFixtureWhateverTheMode() {
        assertThat(select(properties(true, ""))).isInstanceOf(MockNessieClient.class);
        assertThat(select(properties(false, ""))).isInstanceOf(MockNessieClient.class);
    }

}
