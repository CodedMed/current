package com.cashflowcopilot.auth;

import com.cashflowcopilot.error.ApiException;
import com.cashflowcopilot.error.ErrorCode;
import com.cashflowcopilot.persona.PersonaStatus;
import com.cashflowcopilot.user.AppUser;
import org.springframework.stereotype.Component;

/** Financial data is only readable once Persona has approved the identity inquiry. */
@Component
public class PersonaAccessGuard {

    public void requireApproved(AppUser user) {
        if (user.personaStatus() != PersonaStatus.APPROVED) {
            throw new ApiException(
                    ErrorCode.PERSONA_NOT_VERIFIED,
                    "Identity verification is required before financial data can be accessed.");
        }
    }
}
