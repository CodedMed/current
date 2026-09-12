package com.cashflowcopilot.advisor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * The advisor context is the only financial shape a model may see. These tests pin down that it
 * carries the seeded demo business's computed figures and named items, and never anything that
 * would identify an account, a payment destination or a raw ledger row.
 */
@SpringBootTest(properties = {"app.demo-mode=true", "app.database-url=", "app.internal-service-token=advisor-test"})
@AutoConfigureMockMvc
class AdvisorContextTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("X-Internal-Service-Token", "advisor-test").header("X-Auth-Subject", "advisor-demo-user");
    }

    String body(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(auth(request)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    }

    JsonNode seededContext() throws Exception {
        body(post("/v1/persona/dev/verify"));
        body(post("/v1/demo/seed"));
        return mapper.readTree(body(get("/v1/advisor/context")));
    }

    @Test
    void carriesTheComputedFiguresAndNamedItemsOfTheSeededBusiness() throws Exception {
        JsonNode context = seededContext();

        assertThat(context.get("asOfDate").asText()).isEqualTo(LocalDate.now(ZoneOffset.UTC).toString());
        assertThat(context.get("horizonDays").asInt()).isEqualTo(60);
        assertThat(context.get("currentCash").decimalValue()).isPositive();

        BigDecimal inflow30 = context.get("expectedInflow30d").decimalValue();
        BigDecimal outflow30 = context.get("expectedOutflow30d").decimalValue();
        assertThat(context.get("net30d").decimalValue()).isEqualByComparingTo(inflow30.subtract(outflow30));
        assertThat(context.get("expectedInflow60d").decimalValue()).isGreaterThanOrEqualTo(inflow30);
        assertThat(context.get("expectedOutflow60d").decimalValue()).isGreaterThanOrEqualTo(outflow30);

        // The seeded scenario projects a gap inside the horizon; the low point is at least that deep.
        assertThat(context.get("firstGapDate").isNull()).isFalse();
        assertThat(context.get("daysUntilGap").asInt()).isBetween(0, 60);
        assertThat(context.get("projectedLowPoint").get("balance").decimalValue()).isNegative();
        assertThat(context.get("projectedLowPoint").get("date").asText()).isNotBlank();

        assertThat(context.get("overdueReceivables")).isNotEmpty();
        assertThat(context.get("overdueReceivables").get(0).get("counterpartyLabel").asText()).isEqualTo("Client A");
        assertThat(context.get("expectedReceivables")).isNotEmpty();
        assertThat(context.get("expectedReceivables").get(0).get("daysUntilDue").asLong()).isGreaterThanOrEqualTo(0);
        assertThat(context.get("upcomingObligations")).isNotEmpty();
        for (JsonNode obligation : context.get("upcomingObligations")) {
            assertThat(obligation.get("label").asText()).isNotBlank();
            assertThat(obligation.get("amount").decimalValue()).isPositive();
            assertThat(obligation.get("dueDate").asText()).isNotBlank();
        }
    }

    @Test
    void neverExposesIdentifiersOrRawRows() throws Exception {
        String json = body(get("/v1/advisor/context")).toLowerCase();

        assertThat(json).doesNotContain("fingerprint");
        assertThat(json).doesNotContain("sourcerecordid");
        assertThat(json).doesNotContain("\"metadata\"");
        assertThat(json).doesNotContain("accountnumber");
        assertThat(json).doesNotContain("routing");
        assertThat(json).doesNotContain("\"userid\"");
    }

    @Test
    void requiresTheInternalTokenAndAVerifiedIdentity() throws Exception {
        mvc.perform(get("/v1/advisor/context")).andExpect(status().isUnauthorized());
        mvc.perform(get("/v1/advisor/context")
                        .header("X-Internal-Service-Token", "advisor-test")
                        .header("X-Auth-Subject", "advisor-unverified-user"))
                .andExpect(status().isForbidden());
    }
}
