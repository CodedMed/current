package com.cashflowcopilot.invoice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@SpringBootTest(properties = {"app.demo-mode=true", "app.database-url=", "app.internal-service-token=ingestion-test"})
@AutoConfigureMockMvc
class InvoiceRiskPersistenceTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    private static final String RISK = """
            {"riskScore":0.87,"severity":"HIGH","rulesScore":0.82,"mlScore":0.94,
             "reasons":["Amount is 30% above the vendor's previous charge","Payment destination changed"],
             "modelVersion":"invoice-risk-v1"}
            """;

    MockHttpServletRequestBuilder as(String subject, MockHttpServletRequestBuilder request) {
        return request.header("X-Internal-Service-Token", "ingestion-test").header("X-Auth-Subject", subject);
    }

    JsonNode ok(String subject, MockHttpServletRequestBuilder request) throws Exception {
        return mapper.readTree(mvc.perform(as(subject, request)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
    }

    UUID createInvoice(String subject) throws Exception {
        String payload = """
                {"vendorKey":"cloud_provider","vendorDisplayName":"Cloud Provider","amount":1300.00,
                 "previousAmount":1000.00,"invoiceDate":"%s","dueDate":"%s","recurring":true,
                 "category":"cloud_services","direction":"OUT","confidence":0.96}
                """.formatted(LocalDate.now(), LocalDate.now().plusDays(17));
        return UUID.fromString(ok(subject, post("/v1/invoices").contentType("application/json").content(payload))
                .get("id").asText());
    }

    @Test
    void storesTheLatestResultAndSurfacesItOnInvoicesAndTheDashboard() throws Exception {
        String subject = "demo-user";
        UUID id = createInvoice(subject);

        JsonNode stored = ok(subject, post("/v1/invoices/" + id + "/risk-result")
                .contentType("application/json").content(RISK));
        assertThat(stored.get("invoiceId").asText()).isEqualTo(id.toString());
        assertThat(stored.get("severity").asText()).isEqualTo("HIGH");
        assertThat(stored.get("mlScore").asDouble()).isEqualTo(0.94);
        assertThat(stored.get("vendorLabel").asText()).isEqualTo("Cloud Provider");

        JsonNode invoice = ok(subject, get("/v1/invoices/" + id));
        assertThat(invoice.get("riskSeverity").asText()).isEqualTo("HIGH");
        assertThat(invoice.get("riskReasons")).hasSize(2);

        // A later, lower score replaces the earlier one everywhere.
        ok(subject, post("/v1/invoices/" + id + "/risk-result").contentType("application/json")
                .content(RISK.replace("0.87", "0.10").replace("\"HIGH\"", "\"LOW\"")));
        assertThat(ok(subject, get("/v1/invoices/" + id)).get("riskSeverity").asText()).isEqualTo("LOW");

        JsonNode dashboard = ok(subject, get("/v1/dashboard"));
        for (JsonNode risky : dashboard.get("highRiskInvoices")) {
            assertThat(risky.get("invoiceId").asText()).isNotEqualTo(id.toString());
        }
    }

    @Test
    void refusesMalformedResultsAndOtherUsersInvoices() throws Exception {
        UUID id = createInvoice("demo-user");

        mvc.perform(as("demo-user", post("/v1/invoices/" + id + "/risk-result")
                        .contentType("application/json").content(RISK.replace("HIGH", "SEVERE"))))
                .andExpect(status().isBadRequest());
        mvc.perform(as("demo-user", post("/v1/invoices/" + id + "/risk-result")
                        .contentType("application/json").content(RISK.replace("0.87", "1.5"))))
                .andExpect(status().isBadRequest());

        ok("risk-other-user", post("/v1/persona/status").contentType("application/json")
                .content("{\"status\":\"approved\"}"));
        mvc.perform(as("risk-other-user", post("/v1/invoices/" + id + "/risk-result")
                        .contentType("application/json").content(RISK)))
                .andExpect(status().isNotFound());
    }
}
