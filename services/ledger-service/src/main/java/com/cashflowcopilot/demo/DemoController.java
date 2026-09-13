package com.cashflowcopilot.demo;

import com.cashflowcopilot.auth.CurrentUser;
import com.cashflowcopilot.user.AppUser;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Demo-only. Lets the BFF give a freshly verified user the seeded demo business so the whole
 * narrative works without sponsor credentials. Refused with NOT_IMPLEMENTED outside demo mode.
 */
@RestController
@RequestMapping("/v1/demo")
public class DemoController {

    private final DemoSeedService demoSeedService;

    public DemoController(DemoSeedService demoSeedService) {
        this.demoSeedService = demoSeedService;
    }

    /**
     * {@code includeBankData=false} seeds only what a user with their own bank workspace still
     * needs for the walkthrough: the vendor invoice history the risk engine compares against.
     */
    @PostMapping("/seed")
    public DemoSeedService.SeedResult seed(
            @CurrentUser AppUser user,
            @RequestBody(required = false) SeedRequest request) {
        boolean includeBankData = request == null || request.includeBankData() == null || request.includeBankData();
        return demoSeedService.seedIfEmpty(user, includeBankData);
    }

    public record SeedRequest(Boolean includeBankData) {}
}
