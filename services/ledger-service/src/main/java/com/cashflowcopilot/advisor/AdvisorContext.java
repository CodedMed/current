package com.cashflowcopilot.advisor;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * The only financial shape that may be handed to a reasoning model. Built from an explicit
 * allowlist of computed values: no raw database rows, no document text, no account identifiers,
 * no payment fingerprints, no free-form metadata.
 *
 * <p>Everything here is deterministic output of this service (balances, sums, the forecast walk).
 * The reasoning layer explains these numbers; it never recomputes them.
 */
public record AdvisorContext(
        /** The ledger's "today" (UTC), so the model can reason about "this week" and anchor due dates. */
        LocalDate asOfDate,
        int horizonDays,
        BigDecimal currentCash,
        BigDecimal expectedInflow30d,
        BigDecimal expectedOutflow30d,
        BigDecimal net30d,
        BigDecimal expectedInflow60d,
        BigDecimal expectedOutflow60d,
        BigDecimal net60d,
        Instant firstGapDate,
        BigDecimal firstGapAmount,
        Integer daysUntilGap,
        /** Lowest projected balance inside the horizon, from the forecast walk. */
        ProjectedPoint projectedLowPoint,
        /** Projected balance at the end of the horizon. */
        BigDecimal projectedEndBalance,
        List<InvoiceSummary> overdueReceivables,
        List<ExpectedReceivable> expectedReceivables,
        List<ObligationSummary> upcomingObligations,
        List<InvoiceRiskSummary> invoiceRisks,
        List<TodoSummary> openTodos
) {

    public record InvoiceSummary(String counterpartyLabel, BigDecimal amount, long daysOverdue) {}

    public record ExpectedReceivable(String counterpartyLabel, BigDecimal amount, LocalDate dueDate, long daysUntilDue) {}

    /** An outflow still to be paid. {@code daysUntilDue} is negative when it is already overdue. */
    public record ObligationSummary(
            String label,
            String category,
            BigDecimal amount,
            LocalDate dueDate,
            long daysUntilDue,
            String status
    ) {}

    public record ProjectedPoint(LocalDate date, BigDecimal balance, String label) {}

    public record InvoiceRiskSummary(
            UUID invoiceId,
            String vendorLabel,
            double riskScore,
            String severity,
            List<String> reasons
    ) {}

    public record TodoSummary(UUID id, String title, String status, String priority, LocalDate dueDate) {}
}
