package com.cashflowcopilot.bank;

import com.cashflowcopilot.nessie.dto.NessieDtos.NessieAccountDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieBillDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieDepositDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessiePurchaseDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieWithdrawalDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.List;

/**
 * A bank snapshot as the BFF holds it: the records the Nessie API returned for the user's
 * workspace, with merchant names already resolved. Dates are calendar dates ({@code YYYY-MM-DD});
 * card balances are the amount owed (positive), the same convention as the bank.
 */
public record BankSnapshotRequest(
        @NotBlank @Size(max = 200) String customerId,
        @NotNull @Size(max = 50) List<@Valid Account> accounts,
        @NotNull @Size(max = 5000) List<@Valid Movement> deposits,
        @NotNull @Size(max = 5000) List<@Valid Movement> withdrawals,
        @NotNull @Size(max = 5000) List<@Valid Purchase> purchases,
        @NotNull @Size(max = 2000) List<@Valid Bill> bills
) {

    public record Account(
            @NotBlank @Size(max = 100) String id,
            @NotBlank @Size(max = 40) String type,
            @Size(max = 160) String nickname,
            @NotNull @Digits(integer = 12, fraction = 2) BigDecimal balance
    ) {}

    public record Movement(
            @NotBlank @Size(max = 100) String id,
            @NotBlank @Size(max = 100) String accountId,
            @NotNull LocalDate date,
            @NotBlank @Size(max = 20) String status,
            @NotNull @DecimalMin("0") @Digits(integer = 12, fraction = 2) BigDecimal amount,
            @Size(max = 300) String description
    ) {}

    public record Purchase(
            @NotBlank @Size(max = 100) String id,
            @NotBlank @Size(max = 100) String accountId,
            @NotNull LocalDate date,
            @NotBlank @Size(max = 20) String status,
            @NotNull @DecimalMin("0") @Digits(integer = 12, fraction = 2) BigDecimal amount,
            @Size(max = 300) String description,
            @Size(max = 160) String merchantName,
            @Size(max = 100) String merchantCategory
    ) {}

    public record Bill(
            @NotBlank @Size(max = 100) String id,
            @NotBlank @Size(max = 100) String accountId,
            @Size(max = 160) String payee,
            @Size(max = 160) String nickname,
            @NotNull LocalDate paymentDate,
            @NotBlank @Size(max = 20) String status,
            @NotNull @DecimalMin("0") @Digits(integer = 12, fraction = 2) BigDecimal amount,
            boolean recurring
    ) {}

    public BankFeed toFeed() {
        return new BankFeed(
                accounts.stream()
                        .map(a -> new NessieAccountDto(a.id(), a.type(), a.nickname(), a.balance()))
                        .toList(),
                purchases.stream()
                        .map(p -> new NessiePurchaseDto(p.id(), p.accountId(), at(p.date()), p.amount(), p.status(),
                                p.description(), p.merchantCategory(), p.merchantName()))
                        .toList(),
                deposits.stream()
                        .map(d -> new NessieDepositDto(d.id(), d.accountId(), at(d.date()), d.amount(), d.status(), d.description()))
                        .toList(),
                withdrawals.stream()
                        .map(w -> new NessieWithdrawalDto(w.id(), w.accountId(), at(w.date()), w.amount(), w.status(), w.description()))
                        .toList(),
                bills.stream()
                        .map(b -> new NessieBillDto(b.id(), b.accountId(), b.payee(), b.nickname(), at(b.paymentDate()),
                                b.amount(), b.status(), b.recurring(), null))
                        .toList());
    }

    /** Noon UTC, like the demo fixture, so same-day events sort deterministically and plot on their day. */
    private static Instant at(LocalDate date) {
        return date.atTime(LocalTime.NOON).toInstant(ZoneOffset.UTC);
    }
}
