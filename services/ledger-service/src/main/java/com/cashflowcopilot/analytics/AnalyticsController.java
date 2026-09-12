package com.cashflowcopilot.analytics;

import com.cashflowcopilot.auth.CurrentUser;
import com.cashflowcopilot.user.AppUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/analytics")
public class AnalyticsController {

    private final SpendAnalyticsService analyticsService;

    public AnalyticsController(SpendAnalyticsService analyticsService) {
        this.analyticsService = analyticsService;
    }

    /** Spending velocity over settled transactions. {@code days} is clamped server-side. */
    @GetMapping("/spend")
    public SpendAnalytics spend(
            @CurrentUser AppUser user,
            @RequestParam(name = "days", required = false) Integer days) {
        return analyticsService.analyse(user, days);
    }
}
