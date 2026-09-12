package com.cashflowcopilot.nessie;

import com.cashflowcopilot.nessie.dto.NessieDtos.NessieAccountDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieBillDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieDepositDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessiePurchaseDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.springframework.core.io.ClassPathResource;

/**
 * Serves the demo business from {@code samples/seed/nessie_mock.json}. Fixture dates are day
 * offsets so the demo timeline is always anchored to today.
 */
public class MockNessieClient implements NessieClient {

    private static final String FIXTURE = "samples/seed/nessie_mock.json";

    private final Clock clock;
    private final JsonNode fixture;

    public MockNessieClient(ObjectMapper objectMapper, Clock clock) {
        this.clock = clock;
        try (InputStream stream = new ClassPathResource(FIXTURE).getInputStream()) {
            this.fixture = objectMapper.readTree(stream);
        } catch (IOException e) {
            throw new IllegalStateException("Demo bank fixture " + FIXTURE + " could not be read", e);
        }
    }

    public String demoCustomerId() {
        return fixture.path("customerId").asText();
    }

    @Override
    public List<NessieAccountDto> getAccounts(String customerId) {
        List<NessieAccountDto> accounts = new ArrayList<>();
        for (JsonNode node : fixture.withArray("accounts")) {
            accounts.add(new NessieAccountDto(
                    node.path("id").asText(),
                    node.path("type").asText(),
                    node.path("nickname").asText(),
                    node.path("balance").decimalValue()));
        }
        return accounts;
    }

    @Override
    public List<NessiePurchaseDto> getPurchases(String accountId) {
        List<NessiePurchaseDto> purchases = new ArrayList<>();
        for (JsonNode node : fixture.withArray("purchases")) {
            if (!matchesAccount(node, accountId)) {
                continue;
            }
            purchases.add(new NessiePurchaseDto(
                    node.path("id").asText(),
                    node.path("accountId").asText(),
                    resolveDate(node),
                    node.path("amount").decimalValue(),
                    node.path("status").asText(),
                    node.path("description").asText(),
                    node.path("category").asText(null)));
        }
        return purchases;
    }

    @Override
    public List<NessieDepositDto> getDeposits(String accountId) {
        List<NessieDepositDto> deposits = new ArrayList<>();
        for (JsonNode node : fixture.withArray("deposits")) {
            if (!matchesAccount(node, accountId)) {
                continue;
            }
            deposits.add(new NessieDepositDto(
                    node.path("id").asText(),
                    node.path("accountId").asText(),
                    resolveDate(node),
                    node.path("amount").decimalValue(),
                    node.path("status").asText(),
                    node.path("description").asText()));
        }
        return deposits;
    }

    @Override
    public List<NessieBillDto> getBills(String accountId) {
        List<NessieBillDto> bills = new ArrayList<>();
        for (JsonNode node : fixture.withArray("bills")) {
            if (!matchesAccount(node, accountId)) {
                continue;
            }
            bills.add(new NessieBillDto(
                    node.path("id").asText(),
                    node.path("accountId").asText(),
                    node.path("payee").asText(),
                    node.path("nickname").asText(),
                    resolveDate(node),
                    node.path("amount").decimalValue(),
                    node.path("status").asText(),
                    node.path("recurring").asBoolean(false),
                    node.path("category").asText(null)));
        }
        return bills;
    }

    /** Total balance across the demo accounts. */
    public BigDecimal totalBalance() {
        return getAccounts(demoCustomerId()).stream()
                .map(NessieAccountDto::balance)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private boolean matchesAccount(JsonNode node, String accountId) {
        return accountId == null || accountId.equals(node.path("accountId").asText());
    }

    private Instant resolveDate(JsonNode node) {
        long dayOffset = node.path("dayOffset").asLong();
        return LocalTime.NOON
                .atDate(Instant.now(clock).atZone(ZoneOffset.UTC).toLocalDate().plusDays(dayOffset))
                .toInstant(ZoneOffset.UTC);
    }
}
