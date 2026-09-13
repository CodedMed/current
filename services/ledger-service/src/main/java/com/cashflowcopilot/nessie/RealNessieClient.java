package com.cashflowcopilot.nessie;

import com.cashflowcopilot.config.AppProperties;
import com.cashflowcopilot.error.ApiException;
import com.cashflowcopilot.error.ErrorCode;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieAccountDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieBillDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieDepositDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessiePurchaseDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieWithdrawalDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Live Nessie client. Field names follow the API's snake_case payloads ({@code purchase_date},
 * {@code transaction_date}, {@code payment_date}, {@code payment_amount}); dates are calendar
 * dates. The API answers 404 for an empty collection, which is an empty list here, and error
 * messages never carry the request URL because it contains the API key.
 */
public class RealNessieClient implements NessieClient {

    private static final Logger log = LoggerFactory.getLogger(RealNessieClient.class);

    private final AppProperties.Nessie config;
    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    /** Merchant names and categories are stable; resolve each id once per client. */
    private final Map<String, JsonNode> merchants = new ConcurrentHashMap<>();

    public RealNessieClient(AppProperties.Nessie config) {
        this.config = config;
        this.restClient = RestClient.builder().baseUrl(config.baseUrl()).build();
        this.objectMapper = new ObjectMapper();
    }

    @Override
    public List<NessieAccountDto> getAccounts(String customerId) {
        List<NessieAccountDto> accounts = new ArrayList<>();
        for (JsonNode node : list("/customers/{id}/accounts", customerId, "accounts")) {
            accounts.add(new NessieAccountDto(
                    node.path("_id").asText(),
                    node.path("type").asText(),
                    node.path("nickname").asText(),
                    node.path("balance").decimalValue()));
        }
        return accounts;
    }

    @Override
    public List<NessiePurchaseDto> getPurchases(String accountId) {
        List<NessiePurchaseDto> purchases = new ArrayList<>();
        for (JsonNode node : list("/accounts/{id}/purchases", accountId, "purchases")) {
            JsonNode merchant = merchant(node.path("merchant_id").asText(null));
            purchases.add(new NessiePurchaseDto(
                    node.path("_id").asText(),
                    accountId,
                    parseDate(node.path("purchase_date"), node.path("transaction_date")),
                    node.path("amount").decimalValue(),
                    node.path("status").asText(),
                    node.path("description").asText(""),
                    merchant == null ? null : merchant.path("category").asText(null),
                    merchant == null ? null : merchant.path("name").asText(null)));
        }
        return purchases;
    }

    @Override
    public List<NessieDepositDto> getDeposits(String accountId) {
        List<NessieDepositDto> deposits = new ArrayList<>();
        for (JsonNode node : list("/accounts/{id}/deposits", accountId, "deposits")) {
            deposits.add(new NessieDepositDto(
                    node.path("_id").asText(),
                    accountId,
                    parseDate(node.path("transaction_date"), node.path("transactionDate")),
                    node.path("amount").decimalValue(),
                    node.path("status").asText(),
                    node.path("description").asText("")));
        }
        return deposits;
    }

    @Override
    public List<NessieWithdrawalDto> getWithdrawals(String accountId) {
        List<NessieWithdrawalDto> withdrawals = new ArrayList<>();
        for (JsonNode node : list("/accounts/{id}/withdrawals", accountId, "withdrawals")) {
            withdrawals.add(new NessieWithdrawalDto(
                    node.path("_id").asText(),
                    accountId,
                    parseDate(node.path("transaction_date"), node.path("transactionDate")),
                    node.path("amount").decimalValue(),
                    node.path("status").asText(),
                    node.path("description").asText("")));
        }
        return withdrawals;
    }

    @Override
    public List<NessieBillDto> getBills(String accountId) {
        List<NessieBillDto> bills = new ArrayList<>();
        for (JsonNode node : list("/accounts/{id}/bills", accountId, "bills")) {
            String status = node.path("status").asText("");
            bills.add(new NessieBillDto(
                    node.path("_id").asText(),
                    accountId,
                    node.path("payee").asText(null),
                    node.path("nickname").asText(null),
                    parseDate(node.path("upcoming_payment_date"), node.path("payment_date")),
                    node.path("payment_amount").decimalValue(),
                    status,
                    "recurring".equalsIgnoreCase(status),
                    null));
        }
        return bills;
    }

    private JsonNode merchant(String merchantId) {
        if (merchantId == null || merchantId.isBlank()) {
            return null;
        }
        return merchants.computeIfAbsent(merchantId, id -> {
            try {
                String body = restClient.get()
                        .uri(builder -> builder.path("/merchants/{id}").queryParam("key", config.apiKey()).build(id))
                        .retrieve()
                        .body(String.class);
                return body == null || body.isBlank() ? objectMapper.createObjectNode() : objectMapper.readTree(body);
            } catch (Exception e) {
                log.warn("Nessie merchant {} could not be resolved", id);
                return objectMapper.createObjectNode();
            }
        });
    }

    private List<JsonNode> list(String template, String id, String what) {
        String body;
        try {
            body = restClient.get()
                    .uri(builder -> builder.path(template).queryParam("key", config.apiKey()).build(id))
                    .retrieve()
                    .body(String.class);
        } catch (HttpClientErrorException.NotFound e) {
            // Nessie answers 404 ("No … found") for an empty collection.
            return List.of();
        } catch (RestClientException e) {
            log.error("Nessie request for {} failed: {}", what, e.getClass().getSimpleName());
            throw new ApiException(ErrorCode.NESSIE_SYNC_FAILED, "Nessie did not return " + what + ".");
        }
        if (body == null || body.isBlank()) {
            return List.of();
        }
        try {
            JsonNode parsed = objectMapper.readTree(body);
            if (!parsed.isArray()) {
                return List.of();
            }
            List<JsonNode> nodes = new ArrayList<>();
            parsed.forEach(nodes::add);
            return nodes;
        } catch (Exception e) {
            throw new ApiException(ErrorCode.NESSIE_SYNC_FAILED, "Nessie returned an unreadable " + what + " payload.");
        }
    }

    /** Nessie dates are {@code YYYY-MM-DD}; an ISO instant is accepted too. */
    static Instant parseDate(JsonNode... candidates) {
        for (JsonNode node : candidates) {
            if (node == null || node.isMissingNode() || node.isNull()) {
                continue;
            }
            String value = node.asText("");
            if (value.isBlank()) {
                continue;
            }
            try {
                return LocalDate.parse(value.length() > 10 ? value.substring(0, 10) : value)
                        .atTime(LocalTime.NOON)
                        .toInstant(ZoneOffset.UTC);
            } catch (DateTimeParseException ignored) {
                // not a calendar date
            }
            try {
                return Instant.parse(value);
            } catch (DateTimeParseException ignored) {
                log.warn("Unparseable Nessie date: {}", value);
            }
        }
        return Instant.now();
    }
}
