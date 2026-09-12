package com.cashflowcopilot.invoice;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * A vendor invoice. Only a non-reversible fingerprint of the payment destination is ever stored;
 * raw account and routing numbers must never reach this service.
 */
public record Invoice(
        UUID id,
        UUID userId,
        String vendorKey,
        String vendorDisplayName,
        String invoiceNumberHash,
        BigDecimal amount,
        BigDecimal previousAmount,
        LocalDate invoiceDate,
        LocalDate dueDate,
        LocalDate paidDate,
        String status,
        boolean recurring,
        String paymentDestinationFingerprint,
        String source,
        Double extractionConfidence,
        Instant createdAt
) {}
