package com.cashflowcopilot.cashevent;

import com.cashflowcopilot.auth.CurrentUser;
import com.cashflowcopilot.user.AppUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/cash-events")
public class CashEventController {

    private final CashEventService cashEventService;

    public CashEventController(CashEventService cashEventService) {
        this.cashEventService = cashEventService;
    }

    @GetMapping
    public List<CashEventDto> list(
            @CurrentUser AppUser user,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to) {

        Instant now = Instant.now();
        Instant rangeStart = from != null ? from : now.minus(30, ChronoUnit.DAYS);
        Instant rangeEnd = to != null ? to : now.plus(60, ChronoUnit.DAYS);
        return cashEventService.listInRange(user.id(), rangeStart, rangeEnd).stream()
                .map(CashEventDto::from)
                .toList();
    }

    @PostMapping("/manual")
    public CashEventDto createManual(@CurrentUser AppUser user, @Valid @RequestBody ManualCashEventRequest request) {
        CashEvent event = CashEventService.newEvent(
                user.id(),
                request.eventTime(),
                request.amount(),
                request.direction(),
                request.category(),
                CashEventSource.MANUAL,
                null,
                request.description(),
                Boolean.TRUE.equals(request.recurring()),
                request.status() == null ? CashEventStatus.EXPECTED : request.status(),
                Map.of());
        return CashEventDto.from(cashEventService.create(event));
    }

    public record ManualCashEventRequest(
            @NotNull Instant eventTime,
            @NotNull @DecimalMin(value = "0.00", inclusive = true) BigDecimal amount,
            @NotNull Direction direction,
            @NotBlank String category,
            String description,
            Boolean recurring,
            CashEventStatus status
    ) {}

    public record CashEventDto(
            UUID id,
            Instant eventTime,
            BigDecimal amount,
            Direction direction,
            String category,
            CashEventSource source,
            String description,
            boolean recurring,
            CashEventStatus status,
            Map<String, Object> metadata
    ) {
        public static CashEventDto from(CashEvent event) {
            return new CashEventDto(
                    event.id(),
                    event.eventTime(),
                    event.amount(),
                    event.direction(),
                    event.category(),
                    event.source(),
                    event.description(),
                    event.recurring(),
                    event.status(),
                    event.metadata());
        }
    }
}
