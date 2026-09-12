package com.cashflowcopilot.user;

import com.cashflowcopilot.persona.PersonaStatus;
import java.time.Instant;
import java.util.UUID;

public record AppUser(
        UUID id,
        String externalAuthSubject,
        String email,
        String displayName,
        PersonaStatus personaStatus,
        String personaInquiryId,
        Instant createdAt,
        Instant updatedAt
) {}
