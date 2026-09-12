package com.cashflowcopilot.forecast;

import com.cashflowcopilot.auth.CurrentUser;
import com.cashflowcopilot.user.AppUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/forecast")
public class ForecastController {

    private final CashFlowForecastService forecastService;

    public ForecastController(CashFlowForecastService forecastService) {
        this.forecastService = forecastService;
    }

    @GetMapping
    public CashFlowForecast forecast(
            @CurrentUser AppUser user,
            @RequestParam(required = false) Integer horizonDays) {
        return forecastService.forecast(user, horizonDays);
    }
}
