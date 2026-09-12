package com.cashflowcopilot.dashboard;

import com.cashflowcopilot.cashevent.CashEvent;
import com.cashflowcopilot.cashevent.CashEventService;
import com.cashflowcopilot.cashevent.CashEventStatus;
import com.cashflowcopilot.cashevent.Direction;
import com.cashflowcopilot.config.AppProperties;
import com.cashflowcopilot.dashboard.DashboardResponse.Gap;
import com.cashflowcopilot.dashboard.DashboardResponse.Meta;
import com.cashflowcopilot.dashboard.DashboardResponse.Obligation;
import com.cashflowcopilot.dashboard.DashboardResponse.PriorityTask;
import com.cashflowcopilot.dashboard.DashboardResponse.Receivable;
import com.cashflowcopilot.dashboard.DashboardResponse.RiskyInvoice;
import com.cashflowcopilot.dashboard.DashboardResponse.SeriesPoint;
import com.cashflowcopilot.dashboard.DashboardResponse.Totals;
import com.cashflowcopilot.forecast.CashFlowForecast;
import com.cashflowcopilot.forecast.CashFlowForecastService;
import com.cashflowcopilot.forecast.ForecastPoint;
import com.cashflowcopilot.invoice.InvoiceService;
import com.cashflowcopilot.nessie.NessieSyncService;
import com.cashflowcopilot.todo.TodoService;
import com.cashflowcopilot.user.AppUser;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.stereotype.Service;

@Service
public class DashboardService {

    private static final int HISTORY_DAYS = 30;
    private static final int MAX_LIST_ITEMS = 5;

    private final CashFlowForecastService forecastService;
    private final CashEventService cashEventService;
    private final NessieSyncService nessieSyncService;
    private final InvoiceService invoiceService;
    private final TodoService todoService;
    private final AppProperties properties;
    private final Clock clock;

    public DashboardService(
            CashFlowForecastService forecastService,
            CashEventService cashEventService,
            NessieSyncService nessieSyncService,
            InvoiceService invoiceService,
            TodoService todoService,
            AppProperties properties,
            Clock clock) {
        this.forecastService = forecastService;
        this.cashEventService = cashEventService;
        this.nessieSyncService = nessieSyncService;
        this.invoiceService = invoiceService;
        this.todoService = todoService;
        this.properties = properties;
        this.clock = clock;
    }

    public DashboardResponse build(AppUser user, Integer horizonDays) {
        Instant now = Instant.now(clock);
        CashFlowForecast forecast = forecastService.forecast(user, horizonDays);
        Instant in30Days = now.plus(Duration.ofDays(30));

        BigDecimal inflow30d = cashEventService.sumOutstanding(user.id(), Direction.IN, now, in30Days);
        BigDecimal outflow30d = cashEventService.sumOutstanding(user.id(), Direction.OUT, now, in30Days);

        List<CashEvent> history = cashEventService
                .listInRange(user.id(), now.minus(Duration.ofDays(HISTORY_DAYS)), now).stream()
                .filter(event -> event.status() == CashEventStatus.ACTUAL)
                .toList();

        List<CashEvent> outstanding = cashEventService.outstandingThrough(
                user.id(), now.plus(Duration.ofDays(forecast.horizonDays())));

        return new DashboardResponse(
                new Totals(
                        forecast.currentCash(),
                        inflow30d,
                        outflow30d,
                        inflow30d.subtract(outflow30d)),
                gapOf(forecast, now),
                buildSeries(forecast, history, now),
                upcomingObligations(outstanding),
                overdueReceivables(outstanding, now),
                highRiskInvoices(user),
                priorityTasks(user),
                new Meta(
                        forecast.horizonDays(),
                        now,
                        nessieSyncService.lastSyncedAt(user),
                        properties.demoMode()));
    }

    private Gap gapOf(CashFlowForecast forecast, Instant now) {
        if (!forecast.hasGap()) {
            return Gap.none();
        }
        long days = Duration.between(now, forecast.firstGapDate()).toDays();
        return new Gap(true, forecast.firstGapDate(), forecast.firstGapAmount(), (int) days);
    }

    /**
     * Two lines meeting at today: the past is reconstructed by replaying settled events from the
     * start of the window up to today's bank balance, the future comes straight from the
     * deterministic forecast. Overdue items carry dates in the past but belong to the projection,
     * so they are plotted on today.
     */
    private List<SeriesPoint> buildSeries(CashFlowForecast forecast, List<CashEvent> history, Instant now) {
        LocalDate today = now.atZone(ZoneOffset.UTC).toLocalDate();
        LocalDate start = today.minusDays(HISTORY_DAYS);
        LocalDate end = today.plusDays(forecast.horizonDays());

        Map<LocalDate, BigDecimal[]> settledFlows = new HashMap<>();
        BigDecimal settledNet = BigDecimal.ZERO.setScale(2, RoundingMode.HALF_UP);
        for (CashEvent event : history) {
            LocalDate date = event.eventTime().atZone(ZoneOffset.UTC).toLocalDate();
            addFlow(settledFlows, date, event.signedAmount());
            settledNet = settledNet.add(event.signedAmount());
        }

        Map<LocalDate, BigDecimal[]> projectedFlows = new HashMap<>();
        TreeMap<LocalDate, BigDecimal> projectedBalanceByDay = new TreeMap<>();
        for (ForecastPoint point : forecast.timeline()) {
            LocalDate eventDate = point.time().atZone(ZoneOffset.UTC).toLocalDate();
            LocalDate plotDate = eventDate.isBefore(today) ? today : eventDate;
            addFlow(projectedFlows, plotDate, point.delta());
            projectedBalanceByDay.put(plotDate, point.projectedBalance());
        }

        // Balance at the start of the window, before the settled events above were applied.
        BigDecimal runningActual = forecast.currentCash().subtract(settledNet);

        List<SeriesPoint> series = new ArrayList<>();
        for (LocalDate date = start; !date.isAfter(end); date = date.plusDays(1)) {
            BigDecimal[] settled = settledFlows.getOrDefault(date, newFlows());
            BigDecimal[] projected = projectedFlows.getOrDefault(date, newFlows());
            BigDecimal actualBalance = null;
            BigDecimal projectedBalance = null;

            if (!date.isAfter(today)) {
                runningActual = runningActual.add(settled[0]).subtract(settled[1]);
                actualBalance = runningActual;
            }
            if (!date.isBefore(today)) {
                Map.Entry<LocalDate, BigDecimal> entry = projectedBalanceByDay.floorEntry(date);
                projectedBalance = entry == null ? forecast.currentCash() : entry.getValue();
            }
            series.add(new SeriesPoint(
                    date,
                    actualBalance,
                    projectedBalance,
                    settled[0].add(projected[0]),
                    settled[1].add(projected[1])));
        }
        return series;
    }

    private void addFlow(Map<LocalDate, BigDecimal[]> flows, LocalDate date, BigDecimal signedAmount) {
        BigDecimal[] bucket = flows.computeIfAbsent(date, key -> newFlows());
        if (signedAmount.signum() >= 0) {
            bucket[0] = bucket[0].add(signedAmount);
        } else {
            bucket[1] = bucket[1].add(signedAmount.abs());
        }
    }

    private List<Obligation> upcomingObligations(List<CashEvent> outstanding) {
        return outstanding.stream()
                .filter(event -> event.direction() == Direction.OUT)
                .limit(MAX_LIST_ITEMS)
                .map(event -> new Obligation(
                        event.id(),
                        event.eventTime(),
                        label(event),
                        event.category(),
                        event.amount(),
                        event.status()))
                .toList();
    }

    private List<Receivable> overdueReceivables(List<CashEvent> outstanding, Instant now) {
        return outstanding.stream()
                .filter(event -> event.direction() == Direction.IN)
                .filter(event -> event.status() == CashEventStatus.OVERDUE)
                .map(event -> new Receivable(
                        event.id(),
                        label(event),
                        event.amount(),
                        event.eventTime(),
                        Math.max(0, Duration.between(event.eventTime(), now).toDays())))
                .toList();
    }

    private List<RiskyInvoice> highRiskInvoices(AppUser user) {
        return invoiceService.latestRisks(user.id()).stream()
                .filter(risk -> risk.riskScore() >= 0.40)
                .sorted((left, right) -> Double.compare(right.riskScore(), left.riskScore()))
                .limit(MAX_LIST_ITEMS)
                .map(risk -> new RiskyInvoice(
                        risk.invoiceId(),
                        risk.vendorLabel(),
                        risk.riskScore(),
                        risk.severity(),
                        risk.reasons()))
                .toList();
    }

    private List<PriorityTask> priorityTasks(AppUser user) {
        return todoService.listOpen(user.id()).stream()
                .limit(MAX_LIST_ITEMS)
                .map(task -> new PriorityTask(
                        task.id(),
                        task.title(),
                        task.status().name(),
                        task.priority().name(),
                        task.dueDate(),
                        task.source().name()))
                .toList();
    }

    private String label(CashEvent event) {
        Object counterparty = event.metadata().get("counterpartyLabel");
        if (counterparty instanceof String label && !label.isBlank()) {
            return label;
        }
        return event.description() == null ? event.category() : event.description();
    }

    private static BigDecimal[] newFlows() {
        BigDecimal zero = BigDecimal.ZERO.setScale(2, RoundingMode.HALF_UP);
        return new BigDecimal[] {zero, zero};
    }
}
