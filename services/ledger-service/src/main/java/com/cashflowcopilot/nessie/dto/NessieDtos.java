package com.cashflowcopilot.nessie.dto;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Upstream bank shapes. These never leave the nessie package: everything the rest of the service
 * sees has already been normalized into CashEvents.
 */
public final class NessieDtos {

    private NessieDtos() {}

    public record NessieAccountDto(
            String id,
            String type,
            String nickname,
            BigDecimal balance
    ) {}

    public record NessiePurchaseDto(
            String id,
            String accountId,
            Instant purchaseDate,
            BigDecimal amount,
            String status,
            String description,
            String category
    ) {}

    public record NessieDepositDto(
            String id,
            String accountId,
            Instant transactionDate,
            BigDecimal amount,
            String status,
            String description
    ) {}

    public record NessieBillDto(
            String id,
            String accountId,
            String payee,
            String nickname,
            Instant paymentDate,
            BigDecimal amount,
            String status,
            boolean recurring,
            String category
    ) {}
}
