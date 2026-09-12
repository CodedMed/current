package com.cashflowcopilot.demo;

import com.cashflowcopilot.auth.CurrentUser;
import com.cashflowcopilot.user.AppUser;
import org.springframework.web.bind.annotation.PostMapping;
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

    @PostMapping("/seed")
    public DemoSeedService.SeedResult seed(@CurrentUser AppUser user) {
        return demoSeedService.seedIfEmpty(user);
    }
}
