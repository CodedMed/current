package com.cashflowcopilot.invoice;

import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.LocalDate;

/** Only sanitized extraction fields are accepted; Java constructs all ledger event fields. */
public record CreateInvoiceRequest(
        @NotBlank @Size(max = 100) @Pattern(regexp = "^[a-z][a-z0-9_]*$") String vendorKey,
        @Size(max = 160) String vendorDisplayName,
        @NotNull @DecimalMin("0") @Digits(integer = 12, fraction = 2) BigDecimal amount,
        @DecimalMin("0") @Digits(integer = 12, fraction = 2) BigDecimal previousAmount,
        LocalDate invoiceDate,
        LocalDate dueDate,
        boolean recurring,
        @NotBlank @Size(max = 100) @Pattern(regexp = "^[a-z][a-z0-9_]*$") String category,
        @Pattern(regexp = "OUT") String direction,
        @NotNull @DecimalMin("0") @DecimalMax("1") Double confidence,
        /** Local hash of the invoice's printed reference; the number itself is never sent. */
        @Pattern(regexp = "^sha256:[a-f0-9]{64}$") String invoiceNumberHash,
        @Pattern(regexp = "^sha256:[a-f0-9]{64}$") String paymentDestinationFingerprint
) {}
