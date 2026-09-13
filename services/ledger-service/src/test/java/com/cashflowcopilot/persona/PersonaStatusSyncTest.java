package com.cashflowcopilot.persona;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** The BFF owns Persona; the ledger only mirrors the decision and gates on it. */
@SpringBootTest(properties = {"app.demo-mode=true", "app.database-url=", "app.internal-service-token=ingestion-test"})
@AutoConfigureMockMvc
class PersonaStatusSyncTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    MockHttpServletRequestBuilder as(String subject, MockHttpServletRequestBuilder request) {
        return request.header("X-Internal-Service-Token", "ingestion-test").header("X-Auth-Subject", subject);
    }

    JsonNode sync(String subject, String body) throws Exception {
        return mapper.readTree(mvc.perform(as(subject, post("/v1/persona/status")
                        .contentType("application/json").content(body)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    @Test
    void mirroredApprovalOpensTheLedgerAndAMirroredDeclineClosesIt() throws Exception {
        String subject = "google:persona-sync-user";
        mvc.perform(as(subject, get("/v1/dashboard"))).andExpect(status().isForbidden());

        JsonNode approved = sync(subject, "{\"status\":\"approved\",\"inquiryId\":\"inq_123\"}");
        assertThat(approved.get("verified").asBoolean()).isTrue();
        assertThat(approved.get("personaStatus").asText()).isEqualTo("approved");
        mvc.perform(as(subject, get("/v1/dashboard"))).andExpect(status().isOk());

        // The wire form is case-insensitive because the stored form is lower-case.
        JsonNode declined = sync(subject, "{\"status\":\"DECLINED\"}");
        assertThat(declined.get("verified").asBoolean()).isFalse();
        mvc.perform(as(subject, get("/v1/dashboard"))).andExpect(status().isForbidden());
    }

    @Test
    void demoSeedGivesAVerifiedUserTheDemoBusinessExactlyOnce() throws Exception {
        String subject = "google:persona-seed-user";
        mvc.perform(as(subject, post("/v1/demo/seed"))).andExpect(status().isForbidden());

        sync(subject, "{\"status\":\"approved\"}");
        JsonNode first = mapper.readTree(mvc.perform(as(subject, post("/v1/demo/seed")))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(first.get("seeded").asBoolean()).isTrue();
        assertThat(first.get("invoices").asInt()).isEqualTo(12);
        assertThat(first.get("todos").asInt()).isEqualTo(2);

        JsonNode again = mapper.readTree(mvc.perform(as(subject, post("/v1/demo/seed")))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(again.get("seeded").asBoolean()).isFalse();

        JsonNode invoices = mapper.readTree(mvc.perform(as(subject, get("/v1/invoices")))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(invoices).hasSize(12);
    }

    @Test
    void theSignInProfileIsStoredWithTheDecisionAndKeptWhenALaterSyncOmitsIt() throws Exception {
        String subject = "google:persona-profile-user";
        JsonNode anonymous = mapper.readTree(mvc.perform(as(subject, get("/v1/me")))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(anonymous.get("email").isNull()).isTrue();

        JsonNode approved = sync(subject,
                "{\"status\":\"approved\",\"email\":\"owner@example.com\",\"displayName\":\"Jordan Rivera\"}");
        assertThat(approved.get("email").asText()).isEqualTo("owner@example.com");
        assertThat(approved.get("displayName").asText()).isEqualTo("Jordan Rivera");

        // A status-only mirror (or blanks) must not erase what is known.
        JsonNode declined = sync(subject, "{\"status\":\"declined\",\"email\":\"  \"}");
        assertThat(declined.get("email").asText()).isEqualTo("owner@example.com");
        assertThat(declined.get("displayName").asText()).isEqualTo("Jordan Rivera");
        assertThat(declined.get("verified").asBoolean()).isFalse();
    }

    @Test
    void unknownStatusesAreRejected() throws Exception {
        mvc.perform(as("google:persona-bad-status", post("/v1/persona/status")
                        .contentType("application/json").content("{\"status\":\"maybe\"}")))
                .andExpect(status().isBadRequest());
    }
}
