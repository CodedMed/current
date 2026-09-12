package com.cashflowcopilot.nessie;

import com.cashflowcopilot.config.AppProperties;
import com.cashflowcopilot.error.ApiException;
import com.cashflowcopilot.error.ErrorCode;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieAccountDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieBillDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieDepositDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessiePurchaseDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.client.RestClient;

public class RealNessieClient implements NessieClient {

    private static final Logger log = LoggerFactory.getLogger(RealNessieClient.class);
    private static final DateTimeFormatter ISO_DATE_TIME = DateTimeFormatter.ISO_INSTANT;

    private final AppProperties.Nessie config;
    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    public RealNessieClient(AppProperties.Nessie config) {
        this.config = config;
        this.restClient = RestClient.builder()
                .baseUrl(config.baseUrl())
                .build();
        this.objectMapper = new ObjectMapper();
    }

    @Override
    public List<NessieAccountDto> getAccounts(String customerId) {
        try {
            String response = restClient
                    .get()
                    .uri(uriBuilder -> uriBuilder
                            .path("/customers/{customerId}/accounts")
                            .queryParam("key", config.apiKey())
                            .build(customerId))
                    .retrieve()
                    .body(String.class);

            if (response == null || response.isEmpty()) {
                return List.of();
            }

            List<NessieAccountDto> accounts = new ArrayList<>();
            JsonNode jsonArray = objectMapper.readTree(response);

            if (jsonArray.isArray()) {
                for (JsonNode node : jsonArray) {
                    accounts.add(parseAccount(node));
                }
            }

            return accounts;
        } catch (Exception e) {
            log.error("Failed to fetch accounts for customer {}", customerId, e);
            throw new ApiException(ErrorCode.NESSIE_SYNC_FAILED,
                    "Failed to fetch accounts from Nessie: " + e.getMessage());
        }
    }

    @Override
    public List<NessiePurchaseDto> getPurchases(String accountId) {
        try {
            String response = restClient
                    .get()
                    .uri(uriBuilder -> uriBuilder
                            .path("/accounts/{accountId}/purchases")
                            .queryParam("key", config.apiKey())
                            .build(accountId))
                    .retrieve()
                    .body(String.class);

            if (response == null || response.isEmpty()) {
                return List.of();
            }

            List<NessiePurchaseDto> purchases = new ArrayList<>();
            JsonNode jsonArray = objectMapper.readTree(response);

            if (jsonArray.isArray()) {
                for (JsonNode node : jsonArray) {
                    purchases.add(parsePurchase(node, accountId));
                }
            }

            return purchases;
        } catch (Exception e) {
            log.error("Failed to fetch purchases for account {}", accountId, e);
            throw new ApiException(ErrorCode.NESSIE_SYNC_FAILED,
                    "Failed to fetch purchases from Nessie: " + e.getMessage());
        }
    }

    @Override
    public List<NessieDepositDto> getDeposits(String accountId) {
        try {
            String response = restClient
                    .get()
                    .uri(uriBuilder -> uriBuilder
                            .path("/accounts/{accountId}/deposits")
                            .queryParam("key", config.apiKey())
                            .build(accountId))
                    .retrieve()
                    .body(String.class);

            if (response == null || response.isEmpty()) {
                return List.of();
            }

            List<NessieDepositDto> deposits = new ArrayList<>();
            JsonNode jsonArray = objectMapper.readTree(response);

            if (jsonArray.isArray()) {
                for (JsonNode node : jsonArray) {
                    deposits.add(parseDeposit(node, accountId));
                }
            }

            return deposits;
        } catch (Exception e) {
            log.error("Failed to fetch deposits for account {}", accountId, e);
            throw new ApiException(ErrorCode.NESSIE_SYNC_FAILED,
                    "Failed to fetch deposits from Nessie: " + e.getMessage());
        }
    }

    @Override
    public List<NessieBillDto> getBills(String accountId) {
        try {
            String response = restClient
                    .get()
                    .uri(uriBuilder -> uriBuilder
                            .path("/accounts/{accountId}/bills")
                            .queryParam("key", config.apiKey())
                            .build(accountId))
                    .retrieve()
                    .body(String.class);

            if (response == null || response.isEmpty()) {
                return List.of();
            }

            List<NessieBillDto> bills = new ArrayList<>();
            JsonNode jsonArray = objectMapper.readTree(response);

            if (jsonArray.isArray()) {
                for (JsonNode node : jsonArray) {
                    bills.add(parseBill(node, accountId));
                }
            }

            return bills;
        } catch (Exception e) {
            log.error("Failed to fetch bills for account {}", accountId, e);
            throw new ApiException(ErrorCode.NESSIE_SYNC_FAILED,
                    "Failed to fetch bills from Nessie: " + e.getMessage());
        }
    }

    private NessieAccountDto parseAccount(JsonNode node) {
        return new NessieAccountDto(
                node.path("_id").asText(),
                node.path("type").asText(),
                node.path("nickname").asText(),
                node.path("balance").decimalValue());
    }

    private NessiePurchaseDto parsePurchase(JsonNode node, String accountId) {
        return new NessiePurchaseDto(
                node.path("_id").asText(),
                accountId,
                parseInstant(node.path("transactionDate")),
                node.path("amount").decimalValue(),
                node.path("status").asText(),
                node.path("description").asText(),
                node.path("category").asText(null));
    }

    private NessieDepositDto parseDeposit(JsonNode node, String accountId) {
        return new NessieDepositDto(
                node.path("_id").asText(),
                accountId,
                parseInstant(node.path("transactionDate")),
                node.path("amount").decimalValue(),
                node.path("status").asText(),
                node.path("description").asText());
    }

    private NessieBillDto parseBill(JsonNode node, String accountId) {
        return new NessieBillDto(
                node.path("_id").asText(),
                accountId,
                node.path("payee").asText(),
                node.path("nickname").asText(),
                parseInstant(node.path("paymentDate")),
                node.path("amount").decimalValue(),
                node.path("status").asText(),
                node.path("recurring").asBoolean(false),
                node.path("category").asText(null));
    }

    private Instant parseInstant(JsonNode node) {
        if (node.isMissingNode() || node.isNull()) {
            return Instant.now();
        }
        String value = node.asText();
        if (value == null || value.isEmpty()) {
            return Instant.now();
        }
        try {
            return Instant.parse(value);
        } catch (Exception e) {
            log.warn("Failed to parse timestamp: {}", value);
            return Instant.now();
        }
    }
}
