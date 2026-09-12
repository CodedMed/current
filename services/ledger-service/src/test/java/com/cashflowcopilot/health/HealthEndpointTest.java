package com.cashflowcopilot.health;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The embedded demo database has no timescaledb, so this pins the degraded shape: the service must
 * start, say so honestly, and report that analytics are being served by the portable path.
 */
@SpringBootTest(properties = {"app.demo-mode=true", "app.database-url="})
@AutoConfigureMockMvc
class HealthEndpointTest {

    @Autowired MockMvc mvc;

    @Test
    void healthReportsThePortablePathWhenTimescaleIsAbsent() throws Exception {
        mvc.perform(get("/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"))
                .andExpect(jsonPath("$.database.engine").value("postgresql"))
                .andExpect(jsonPath("$.database.reachable").value(true))
                .andExpect(jsonPath("$.database.backgroundJobs").value(0))
                .andExpect(jsonPath("$.database.timescaleVersion").doesNotExist())
                .andExpect(jsonPath("$.database.cashEventsHypertable").value(false))
                .andExpect(jsonPath("$.database.cashDailyAggregate").value(false))
                .andExpect(jsonPath("$.database.analyticsSource").value("ROW_SCAN"));
    }
}
