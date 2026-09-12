package com.cashflowcopilot.dashboard;

import com.cashflowcopilot.auth.CurrentUser;
import com.cashflowcopilot.user.AppUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/dashboard")
public class DashboardController {

    private final DashboardService dashboardService;

    public DashboardController(DashboardService dashboardService) {
        this.dashboardService = dashboardService;
    }

    @GetMapping
    public DashboardResponse dashboard(
            @CurrentUser AppUser user,
            @RequestParam(required = false) Integer horizonDays) {
        return dashboardService.build(user, horizonDays);
    }
}
