package com.cashflowcopilot.forecast;

import com.cashflowcopilot.cashevent.CashEvent;
import com.cashflowcopilot.cashevent.CashEventService;
import com.cashflowcopilot.config.AppProperties;
import com.cashflowcopilot.nessie.NessieSyncService;
import com.cashflowcopilot.user.AppUser;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class CashFlowForecastService {

    private final CashEventService cashEventService;
    private final NessieSyncService nessieSyncService;
    private final CashFlowForecastCalculator calculator;
    private final AppProperties properties;
    private final Clock clock;

    public CashFlowForecastService(
            CashEventService cashEventService,
            NessieSyncService nessieSyncService,
            CashFlowForecastCalculator calculator,
            AppProperties properties,
            Clock clock) {
        this.cashEventService = cashEventService;
        this.nessieSyncService = nessieSyncService;
        this.calculator = calculator;
        this.properties = properties;
        this.clock = clock;
    }

    public CashFlowForecast forecast(AppUser user, Integer horizonDays) {
        int horizon = horizonDays == null || horizonDays <= 0 ? properties.defaultHorizonDays() : horizonDays;
        Instant now = Instant.now(clock);
        BigDecimal currentCash = nessieSyncService.currentCash(user);
        List<CashEvent> outstanding =
                cashEventService.outstandingThrough(user.id(), now.plus(horizon, ChronoUnit.DAYS));
        return calculator.calculate(currentCash, outstanding, horizon, now);
    }
}
