package com.cashflowcopilot.dashboard;

import com.cashflowcopilot.cashevent.CashEventStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Everything the dashboard renders, computed server-side so the browser does no financial math. */
public record DashboardResponse(
        Totals totals,
        Gap projectedGap,
        List<SeriesPoint> cashFlowSeries,
        List<Obligation> upcomingObligations,
        List<Receivable> overdueReceivables,
        List<RiskyInvoice> highRiskInvoices,
        List<PriorityTask> priorityTasks,
        Meta meta
) {

    public record Totals(
            BigDecimal availableCash,
            BigDecimal expectedInflow30d,
            BigDecimal expectedOutflow30d,
            BigDecimal net30d
    ) {}

    public record Gap(boolean present, Instant date, BigDecimal amount, Integer daysFromNow) {

        public static Gap none() {
            return new Gap(false, null, null, null);
        }
    }

    /**
     * One point per day. {@code actualBalance} covers the reconstructed past,
     * {@code projectedBalance} the forecast; they overlap on today so the chart line is continuous.
     */
    public record SeriesPoint(
            LocalDate date,
            BigDecimal actualBalance,
            BigDecimal projectedBalance,
            BigDecimal inflow,
            BigDecimal outflow
    ) {}

    public record Obligation(
            UUID cashEventId,
            Instant dueDate,
            String label,
            String category,
            BigDecimal amount,
            CashEventStatus status
    ) {}

    public record Receivable(
            UUID cashEventId,
            String counterpartyLabel,
            BigDecimal amount,
            Instant dueDate,
            long daysOverdue
    ) {}

    public record RiskyInvoice(
            UUID invoiceId,
            String vendorLabel,
            double riskScore,
            String severity,
            List<String> reasons
    ) {}

    public record PriorityTask(
            UUID id,
            String title,
            String status,
            String priority,
            LocalDate dueDate,
            String source
    ) {}

    public record Meta(int horizonDays, Instant generatedAt, Instant lastSyncedAt, boolean demoMode) {}
}
