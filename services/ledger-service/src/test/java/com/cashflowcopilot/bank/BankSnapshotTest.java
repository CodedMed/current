package com.cashflowcopilot.bank;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * The BFF pushes the workspace's bank snapshot; the ledger becomes the same business the Keel
 * dashboard shows, and available cash comes from the ingested balances rather than a live call.
 */
@SpringBootTest(properties = {"app.demo-mode=true", "app.database-url=", "app.internal-service-token=bank-test"})
@AutoConfigureMockMvc
class BankSnapshotTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired BankAccountRepository bankAccounts;

    MockHttpServletRequestBuilder as(String subject, MockHttpServletRequestBuilder request) {
        return request.header("X-Internal-Service-Token", "bank-test").header("X-Auth-Subject", subject);
    }

    JsonNode ok(String subject, MockHttpServletRequestBuilder request) throws Exception {
        return mapper.readTree(mvc.perform(as(subject, request))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    void verify(String subject) throws Exception {
        ok(subject, post("/v1/persona/status").contentType("application/json").content("{\"status\":\"approved\"}"));
    }

    static String day(int offset) {
        return LocalDate.now(ZoneOffset.UTC).plusDays(offset).toString();
    }

    /** Two accounts, five money movements, an internal transfer and two bills: the Keel workspace in miniature. */
    static String workspaceSnapshot(String customerId) {
        return """
                {
                  "customerId": "%s",
                  "accounts": [
                    {"id": "acc-op", "type": "Checking", "nickname": "Operating", "balance": 9000.00},
                    {"id": "acc-card", "type": "Credit Card", "nickname": "Business card", "balance": 1500.00}
                  ],
                  "deposits": [
                    {"id": "dep-1", "accountId": "acc-op", "date": "%s", "status": "completed", "amount": 6000.00, "description": "Client payment · Acme"},
                    {"id": "dep-2", "accountId": "acc-op", "date": "%s", "status": "pending", "amount": 4000.00, "description": "Invoice 1041 · Client A · net 30"},
                    {"id": "dep-3", "accountId": "acc-res", "date": "%s", "status": "completed", "amount": 500.00, "description": "Transfer · Reserve sweep"}
                  ],
                  "withdrawals": [
                    {"id": "wd-1", "accountId": "acc-op", "date": "%s", "status": "completed", "amount": 5400.00, "description": "Payroll · Gusto"}
                  ],
                  "purchases": [
                    {"id": "pur-1", "accountId": "acc-card", "date": "%s", "status": "completed", "amount": 320.00, "description": "Weekly produce", "merchantName": "Sysco", "merchantCategory": "Food & Beverage"}
                  ],
                  "bills": [
                    {"id": "bill-rent", "accountId": "acc-op", "payee": "Harbor Property Group", "nickname": "Office rent", "paymentDate": "%s", "status": "recurring", "amount": 2200.00, "recurring": true},
                    {"id": "bill-ins", "accountId": "acc-op", "payee": "Northline Insurance", "nickname": "Liability insurance", "paymentDate": "%s", "status": "pending", "amount": 1000.00, "recurring": false}
                  ]
                }
                """.formatted(customerId, day(-3), day(-12), day(-8), day(-5), day(-2), day(-20), day(5));
    }

    @Test
    void aPushedSnapshotBecomesTheUsersCashPositionAndLedger() throws Exception {
        String subject = "google:bank-push-user";
        verify(subject);

        JsonNode result = ok(subject, post("/v1/bank/snapshot")
                .contentType("application/json").content(workspaceSnapshot("cust-a")));
        // The internal transfer is not cash flow; everything else is one event each.
        assertThat(result.get("insertedEvents").asInt()).isEqualTo(6);
        assertThat(result.get("updatedEvents").asInt()).isZero();

        JsonNode summary = ok(subject, get("/v1/accounts/summary"));
        assertThat(summary.get("totalBalance").decimalValue()).isEqualByComparingTo("7500.00");
        assertThat(summary.get("accounts")).hasSize(2);
        assertThat(summary.get("lastSyncedAt").isNull()).isFalse();

        JsonNode forecast = ok(subject, get("/v1/forecast"));
        assertThat(forecast.get("currentCash").decimalValue()).isEqualByComparingTo("7500.00");

        JsonNode dashboard = ok(subject, get("/v1/dashboard"));
        assertThat(dashboard.get("totals").get("availableCash").decimalValue()).isEqualByComparingTo("7500.00");
        List<String> overdue = new ArrayList<>();
        dashboard.get("overdueReceivables").forEach(r -> overdue.add(r.get("counterpartyLabel").asText()));
        assertThat(overdue).containsExactly("Client A");
        List<String> obligations = new ArrayList<>();
        dashboard.get("upcomingObligations").forEach(o -> obligations.add(o.get("label").asText()));
        assertThat(obligations).contains("Harbor Property Group", "Northline Insurance");

        List<String> categories = new ArrayList<>();
        ok(subject, get("/v1/cash-events")).forEach(e -> categories.add(e.get("category").asText()));
        assertThat(categories).contains("payroll", "food_beverage", "client_payment", "client_invoice");
    }

    @Test
    void aSecondPushIsIdempotentAndAChangedCustomerReplacesTheOldFeed() throws Exception {
        String subject = "google:bank-switch-user";
        verify(subject);
        ok(subject, post("/v1/bank/snapshot").contentType("application/json").content(workspaceSnapshot("cust-a")));

        JsonNode again = ok(subject, post("/v1/bank/snapshot")
                .contentType("application/json").content(workspaceSnapshot("cust-a")));
        assertThat(again.get("insertedEvents").asInt()).isZero();
        assertThat(again.get("updatedEvents").asInt()).isEqualTo(6);

        String other = """
                {"customerId": "cust-b",
                 "accounts": [{"id": "acc-x", "type": "Checking", "nickname": "Main", "balance": 1234.00}],
                 "deposits": [{"id": "dep-x", "accountId": "acc-x", "date": "%s", "status": "completed", "amount": 10.00, "description": "Sales"}],
                 "withdrawals": [], "purchases": [], "bills": []}
                """.formatted(day(-1));
        ok(subject, post("/v1/bank/snapshot").contentType("application/json").content(other));

        assertThat(ok(subject, get("/v1/accounts/summary")).get("totalBalance").decimalValue()).isEqualByComparingTo("1234.00");
        assertThat(ok(subject, get("/v1/cash-events"))).hasSize(1);
    }

    @Test
    void requiresAVerifiedIdentityAndAWellFormedSnapshot() throws Exception {
        String subject = "google:bank-unverified-user";
        mvc.perform(as(subject, post("/v1/bank/snapshot")
                        .contentType("application/json").content(workspaceSnapshot("cust-a"))))
                .andExpect(status().isForbidden());

        verify(subject);
        mvc.perform(as(subject, post("/v1/bank/snapshot")
                        .contentType("application/json").content("{\"customerId\":\"c\",\"accounts\":[{\"id\":\"a\",\"type\":\"Checking\",\"balance\":\"lots\"}]}")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void seedingWithoutBankDataAddsOnlyTheVendorHistory() throws Exception {
        String subject = "google:bank-history-only-user";
        verify(subject);

        JsonNode seed = ok(subject, post("/v1/demo/seed")
                .contentType("application/json").content("{\"includeBankData\":false}"));
        assertThat(seed.get("seeded").asBoolean()).isTrue();
        assertThat(seed.get("invoices").asInt()).isEqualTo(12);
        assertThat(seed.get("bankEvents").asInt()).isZero();
        assertThat(seed.get("ledgerEvents").asInt()).isZero();
        assertThat(seed.get("todos").asInt()).isZero();
        assertThat(ok(subject, get("/v1/cash-events"))).isEmpty();
        assertThat(ok(subject, get("/v1/forecast")).get("currentCash").decimalValue()).isZero();
    }

    @Test
    void aUserSeededBeforeBalancesWereStoredGetsThemBackfilled() throws Exception {
        String subject = "google:bank-backfill-user";
        verify(subject);
        ok(subject, post("/v1/demo/seed"));
        assertThat(ok(subject, get("/v1/accounts/summary")).get("totalBalance").decimalValue())
                .isEqualByComparingTo("8000.00");

        // Simulate the pre-upgrade state: events present, balances table empty.
        bankAccounts.replaceAll(userId(subject), List.of(), java.time.Instant.now());
        assertThat(ok(subject, get("/v1/forecast")).get("currentCash").decimalValue()).isZero();

        JsonNode again = ok(subject, post("/v1/demo/seed"));
        assertThat(again.get("seeded").asBoolean()).isFalse();
        assertThat(ok(subject, get("/v1/forecast")).get("currentCash").decimalValue())
                .isEqualByComparingTo("8000.00");
    }

    java.util.UUID userId(String subject) throws Exception {
        return java.util.UUID.fromString(ok(subject, get("/v1/me")).get("userId").asText());
    }

    @Test
    void theDemoCustomerIsAlwaysServedFromTheFixture() throws Exception {
        String subject = "google:bank-demo-fixture-user";
        verify(subject);
        JsonNode sync = ok(subject, post("/v1/nessie/sync"));
        assertThat(sync.get("insertedEvents").asInt()).isGreaterThan(0);
        assertThat(ok(subject, get("/v1/accounts/summary")).get("totalBalance").decimalValue())
                .isEqualByComparingTo("8000.00");
    }
}
