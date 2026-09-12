package com.cashflowcopilot.persona;

import com.cashflowcopilot.auth.CurrentUser;
import com.cashflowcopilot.error.ApiException;
import com.cashflowcopilot.error.ErrorCode;
import com.cashflowcopilot.user.AppUser;
import com.cashflowcopilot.user.MeController.MeResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.Locale;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/persona")
public class PersonaController {

    private final PersonaService personaService;

    public PersonaController(PersonaService personaService) {
        this.personaService = personaService;
    }

    /**
     * Inquiries are created by the BFF, which owns the Persona credentials. This endpoint remains
     * for a deployment where the ledger service talks to Persona directly.
     */
    @PostMapping("/inquiry")
    public Object createInquiry(@CurrentUser(requireVerified = false) AppUser user) {
        throw new ApiException(ErrorCode.NOT_IMPLEMENTED,
                "Persona inquiries are created by the BFF, which mirrors the decision through "
                        + "POST /v1/persona/status.");
    }

    /**
     * Mirrors the verification decision the BFF obtained from Persona. Readable before approval by
     * design: this is the call that grants (or revokes) access to the financial endpoints.
     */
    @PostMapping("/status")
    public MeResponse syncStatus(
            @CurrentUser(requireVerified = false) AppUser user,
            @Valid @RequestBody StatusSyncRequest request) {
        return MeResponse.from(personaService.applyStatus(user, request.status(), request.inquiryId()));
    }

    /** Demo-only. Mirrors the "DEV: Mark Verified" action described in the specification. */
    @PostMapping("/dev/verify")
    public DevVerifyResponse devVerify(@CurrentUser(requireVerified = false) AppUser user) {
        personaService.markVerifiedForDemo(user);
        return new DevVerifyResponse(PersonaStatus.APPROVED.name().toLowerCase(Locale.ROOT));
    }

    public record StatusSyncRequest(@NotNull PersonaStatus status, @Size(max = 200) String inquiryId) {}

    public record DevVerifyResponse(String personaStatus) {}
}
