package com.cashflowcopilot.user;

import com.cashflowcopilot.auth.CurrentUser;
import com.cashflowcopilot.persona.PersonaStatus;
import java.util.Locale;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/me")
public class MeController {

    /** Identity endpoint: readable before verification so the web app can route to /verify. */
    @GetMapping
    public MeResponse me(@CurrentUser(requireVerified = false) AppUser user) {
        return MeResponse.from(user);
    }

    public record MeResponse(
            UUID userId,
            String subject,
            String email,
            String displayName,
            String personaStatus,
            boolean verified
    ) {
        public static MeResponse from(AppUser user) {
            return new MeResponse(
                    user.id(),
                    user.externalAuthSubject(),
                    user.email(),
                    user.displayName(),
                    user.personaStatus().name().toLowerCase(Locale.ROOT),
                    user.personaStatus() == PersonaStatus.APPROVED);
        }
    }
}
