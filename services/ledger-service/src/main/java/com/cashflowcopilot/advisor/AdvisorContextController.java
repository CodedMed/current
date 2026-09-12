package com.cashflowcopilot.advisor;

import com.cashflowcopilot.auth.CurrentUser;
import com.cashflowcopilot.user.AppUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/advisor")
public class AdvisorContextController {

    private final AdvisorContextService advisorContextService;

    public AdvisorContextController(AdvisorContextService advisorContextService) {
        this.advisorContextService = advisorContextService;
    }

    /** Sanitized facts for the reasoning layer. This service never calls an LLM itself. */
    @GetMapping("/context")
    public AdvisorContext context(
            @CurrentUser AppUser user,
            @RequestParam(required = false) Integer horizonDays) {
        return advisorContextService.build(user, horizonDays);
    }
}
