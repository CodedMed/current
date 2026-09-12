package com.cashflowcopilot.advisor;

import com.cashflowcopilot.advisor.AdvisorContext.ExpectedReceivable;
import com.cashflowcopilot.advisor.AdvisorContext.InvoiceRiskSummary;
import com.cashflowcopilot.advisor.AdvisorContext.InvoiceSummary;
import com.cashflowcopilot.advisor.AdvisorContext.ObligationSummary;
import com.cashflowcopilot.advisor.AdvisorContext.ProjectedPoint;
import com.cashflowcopilot.advisor.AdvisorContext.TodoSummary;
import com.cashflowcopilot.cashevent.CashEvent;
import com.cashflowcopilot.cashevent.CashEventService;
import com.cashflowcopilot.cashevent.CashEventStatus;
import com.cashflowcopilot.cashevent.Direction;
import com.cashflowcopilot.dashboard.DashboardResponse;
import com.cashflowcopilot.dashboard.DashboardService;
import com.cashflowcopilot.forecast.CashFlowForecast;
import com.cashflowcopilot.forecast.CashFlowForecastService;
import com.cashflowcopilot.forecast.ForecastPoint;
import com.cashflowcopilot.user.AppUser;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * Assembles the allowlisted advisor context. Every figure is computed here or by the services this
 * class delegates to; nothing is passed through from raw rows. The dashboard read model supplies the
 * headline totals, the forecast walk supplies the projection, and the outstanding cash events supply
 * the named upcoming items the advisor may talk about.
 */
@Service
public class AdvisorContextService {

    /** Named items are capped so the model sees the most relevant few, not the whole ledger. */
    private static final int MAX_ITEMS = 8;

    private final DashboardService dashboardService;
    private final CashFlowForecastService forecastService;
    private final CashEventService cashEventService;
    private final Clock clock;

    public AdvisorContextService(
            DashboardService dashboardService,
            CashFlowForecastService forecastService,
            CashEventService cashEventService,
            Clock clock) {
        this.dashboardService = dashboardService;
        this.forecastService = forecastService;
        this.cashEventService = cashEventService;
        this.clock = clock;
    }

    public AdvisorContext build(AppUser user, Integer horizonDays) {
        Instant now = Instant.now(clock);
        LocalDate today = toDate(now);
        DashboardResponse dashboard = dashboardService.build(user, horizonDays);
        CashFlowForecast forecast = forecastService.forecast(user, horizonDays);

        Instant in60Days = now.plus(Duration.ofDays(60));
        BigDecimal inflow60d = cashEventService.sumOutstanding(user.id(), Direction.IN, now, in60Days);
        BigDecimal outflow60d = cashEventService.sumOutstanding(user.id(), Direction.OUT, now, in60Days);

        List<CashEvent> outstanding = cashEventService
                .outstandingThrough(user.id(), now.plus(Duration.ofDays(forecast.horizonDays())))
                .stream()
                .sorted(Comparator.comparing(CashEvent::eventTime))
                .toList();

        return new AdvisorContext(
                today,
                forecast.horizonDays(),
                dashboard.totals().availableCash(),
                dashboard.totals().expectedInflow30d(),
                dashboard.totals().expectedOutflow30d(),
                dashboard.totals().net30d(),
                inflow60d,
                outflow60d,
                inflow60d.subtract(outflow60d),
                dashboard.projectedGap().date(),
                dashboard.projectedGap().amount(),
                dashboard.projectedGap().daysFromNow(),
                lowPoint(forecast, today),
                endBalance(forecast),
                dashboard.overdueReceivables().stream()
                        .map(receivable -> new InvoiceSummary(
                                receivable.counterpartyLabel(),
                                receivable.amount(),
                                receivable.daysOverdue()))
                        .toList(),
                expectedReceivables(outstanding, now),
                upcomingObligations(outstanding, now),
                dashboard.highRiskInvoices().stream()
                        .map(risk -> new InvoiceRiskSummary(
                                risk.invoiceId(),
                                risk.vendorLabel(),
                                risk.riskScore(),
                                risk.severity(),
                                risk.reasons()))
                        .toList(),
                dashboard.priorityTasks().stream()
                        .map(task -> new TodoSummary(
                                task.id(),
                                task.title(),
                                task.status(),
                                task.priority(),
                                task.dueDate()))
                        .toList());
    }

    /** The deepest point of the projection; the first gap date stays the headline, this is the depth. */
    private ProjectedPoint lowPoint(CashFlowForecast forecast, LocalDate today) {
        ForecastPoint lowest = null;
        for (ForecastPoint point : forecast.timeline()) {
            if (lowest == null || point.projectedBalance().compareTo(lowest.projectedBalance()) < 0) {
                lowest = point;
            }
        }
        if (lowest == null) {
            return null;
        }
        LocalDate date = toDate(lowest.time());
        // Overdue items carry past dates but belong to the projection; they are plotted on today.
        return new ProjectedPoint(date.isBefore(today) ? today : date, lowest.projectedBalance(), lowest.label());
    }

    private BigDecimal endBalance(CashFlowForecast forecast) {
        List<ForecastPoint> timeline = forecast.timeline();
        return timeline.isEmpty() ? forecast.currentCash() : timeline.get(timeline.size() - 1).projectedBalance();
    }

    private List<ExpectedReceivable> expectedReceivables(List<CashEvent> outstanding, Instant now) {
        return outstanding.stream()
                .filter(event -> event.direction() == Direction.IN)
                .filter(event -> event.status() == CashEventStatus.EXPECTED)
                .limit(MAX_ITEMS)
                .map(event -> new ExpectedReceivable(
                        label(event),
                        event.amount(),
                        toDate(event.eventTime()),
                        Math.max(0, daysBetween(now, event.eventTime()))))
                .toList();
    }

    private List<ObligationSummary> upcomingObligations(List<CashEvent> outstanding, Instant now) {
        return outstanding.stream()
                .filter(event -> event.direction() == Direction.OUT)
                .limit(MAX_ITEMS)
                .map(event -> new ObligationSummary(
                        label(event),
                        event.category(),
                        event.amount(),
                        toDate(event.eventTime()),
                        daysBetween(now, event.eventTime()),
                        event.status().name()))
                .toList();
    }

    /** Same labelling rule as the dashboard: counterparty, else description, else category. */
    private static String label(CashEvent event) {
        Object counterparty = event.metadata().get("counterpartyLabel");
        if (counterparty instanceof String label && !label.isBlank()) {
            return label;
        }
        return event.description() == null ? event.category() : event.description();
    }

    private static long daysBetween(Instant from, Instant to) {
        return Duration.between(from, to).toDays();
    }

    private static LocalDate toDate(Instant instant) {
        return instant.atZone(ZoneOffset.UTC).toLocalDate();
    }
}
