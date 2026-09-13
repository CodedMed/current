package com.cashflowcopilot.invoice;

import com.cashflowcopilot.cashevent.*;
import com.fasterxml.jackson.databind.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

@SpringBootTest(properties = {"app.demo-mode=true", "app.database-url=", "app.internal-service-token=ingestion-test"})
@AutoConfigureMockMvc
class InvoiceIngestionTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired InvoiceRepository invoices;
    @Autowired InvoiceService service;
    @MockitoSpyBean CashEventRepository events;

    MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("X-Internal-Service-Token", "ingestion-test").header("X-Auth-Subject", "demo-user");
    }
    JsonNode read(MockHttpServletRequestBuilder request) throws Exception {
        return mapper.readTree(mvc.perform(auth(request)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }
    String payload() {
        return """
                {"vendorKey":"cloud_provider","vendorDisplayName":"Cloud Provider","amount":1300.00,
                 "previousAmount":1000.00,"invoiceDate":"%s","dueDate":"%s","recurring":true,
                 "category":"cloud_services","direction":"OUT","confidence":0.96,
                 "invoiceNumberHash":"sha256:%s"}
                """.formatted(LocalDate.now(), LocalDate.now().plusDays(17), "d".repeat(64));
    }
    UUID verifiedUser() throws Exception {
        read(post("/v1/persona/dev/verify"));
        return UUID.fromString(read(get("/v1/me")).get("userId").asText());
    }

    @Test void persistsInvoiceAndExpectedOutflowAndWorsensForecast() throws Exception {
        UUID user = verifiedUser();
        int beforeInvoices = invoices.countForUser(user);
        int beforeEvents = events.countForUser(user);
        JsonNode before = read(get("/v1/forecast"));
        JsonNode saved = read(post("/v1/invoices").contentType("application/json").content(payload()));
        UUID id = UUID.fromString(saved.get("id").asText());
        assertThat(invoices.countForUser(user)).isEqualTo(beforeInvoices + 1);
        assertThat(events.countForUser(user)).isEqualTo(beforeEvents + 1);
        CashEvent event = events.findBySourceRecord(user, CashEventSource.DOCUMENT, id.toString()).orElseThrow();
        assertThat(event.direction()).isEqualTo(Direction.OUT);
        assertThat(event.status()).isEqualTo(CashEventStatus.EXPECTED);
        assertThat(event.amount()).isEqualByComparingTo("1300.00");
        assertThat(event.metadata()).isEmpty();
        assertThat(saved.get("invoiceNumberHash").asText()).isEqualTo("sha256:" + "d".repeat(64));
        assertThat(invoices.findById(user, id).orElseThrow().invoiceNumberHash()).isEqualTo("sha256:" + "d".repeat(64));
        JsonNode after = read(get("/v1/forecast"));
        assertThat(after.get("expectedOutflow").decimalValue().subtract(before.get("expectedOutflow").decimalValue()))
                .isEqualByComparingTo("1300.00");
        assertThat(invoices.findById(UUID.randomUUID(), id)).isEmpty();
    }

    @Test void aDueDateAlreadyPassedCreatesAnOverdueObligation() throws Exception {
        UUID user = verifiedUser();
        String stale = payload().replace("\"dueDate\":\"" + LocalDate.now().plusDays(17) + "\"",
                "\"dueDate\":\"" + LocalDate.now().minusDays(35) + "\"");
        JsonNode before = read(get("/v1/forecast"));
        UUID id = UUID.fromString(read(post("/v1/invoices").contentType("application/json").content(stale)).get("id").asText());
        CashEvent event = events.findBySourceRecord(user, CashEventSource.DOCUMENT, id.toString()).orElseThrow();
        assertThat(event.status()).isEqualTo(CashEventStatus.OVERDUE);
        assertThat(read(get("/v1/invoices/" + id)).get("status").asText()).isEqualTo("OVERDUE");
        // Overdue money still comes out of the projection.
        JsonNode after = read(get("/v1/forecast"));
        assertThat(after.get("expectedOutflow").decimalValue().subtract(before.get("expectedOutflow").decimalValue()))
                .isEqualByComparingTo("1300.00");
    }

    @Test void rollsBackInvoiceWhenCashEventInsertFails() throws Exception {
        UUID user = verifiedUser();
        int count = invoices.countForUser(user);
        CreateInvoiceRequest request = mapper.readValue(payload(), CreateInvoiceRequest.class);
        doThrow(new IllegalStateException("forced event insert failure")).when(events).insert(any());
        try {
            assertThatThrownBy(() -> service.create(user, request)).isInstanceOf(IllegalStateException.class);
            assertThat(invoices.countForUser(user)).isEqualTo(count);
        } finally { reset(events); }
    }

    @Test void rejectsInvalidMoneyDirectionAndConfidence() throws Exception {
        verifiedUser();
        for (String invalid : new String[] {payload().replace("1300.00", "-1"),
                payload().replace("OUT", "IN"), payload().replace("0.96", "2.0"),
                payload().replace("sha256:" + "d".repeat(64), "CP-2026-0061")}) {
            mvc.perform(auth(post("/v1/invoices").contentType("application/json").content(invalid)))
                    .andExpect(status().isBadRequest());
        }
    }



    @Test void requiresInternalIdentityAndVerification() throws Exception {
        mvc.perform(post("/v1/invoices").contentType("application/json").content(payload()))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/v1/invoices").header("X-Internal-Service-Token", "ingestion-test")
                .header("X-Auth-Subject", "unverified-upload-user").contentType("application/json").content(payload()))
                .andExpect(status().isForbidden());
    }
}
