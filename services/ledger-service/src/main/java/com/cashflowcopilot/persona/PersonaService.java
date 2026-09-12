package com.cashflowcopilot.persona;

import com.cashflowcopilot.config.AppProperties;
import com.cashflowcopilot.error.ApiException;
import com.cashflowcopilot.error.ErrorCode;
import com.cashflowcopilot.user.AppUser;
import com.cashflowcopilot.user.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Persona verification state.
 *
 * <p>In the merged deployment the Express BFF owns the Persona integration: it creates inquiries,
 * re-reads the decision from Persona server-side (never from the browser callback alone) and
 * processes signature-verified webhooks. It then mirrors the resulting status here over the
 * internal service channel so the {@code PersonaAccessGuard} can gate every ledger endpoint.
 *
 * <p>TODO(persona): if this service is ever deployed without the BFF, create inquiries here using
 * the application UUID as {@code referenceId} and drive status changes from webhooks only.
 */
@Service
public class PersonaService {

    private final UserRepository userRepository;
    private final AppProperties properties;

    public PersonaService(UserRepository userRepository, AppProperties properties) {
        this.userRepository = userRepository;
        this.properties = properties;
    }

    public PersonaStatus statusOf(AppUser user) {
        return user.personaStatus();
    }

    /** Demo-only shortcut so the walkthrough does not need Persona credentials. */
    public void markVerifiedForDemo(AppUser user) {
        if (!properties.demoMode()) {
            throw new ApiException(ErrorCode.NOT_IMPLEMENTED,
                    "Development verification is disabled outside demo mode.");
        }
        userRepository.updatePersonaStatus(user.id(), PersonaStatus.APPROVED, null);
    }

    /**
     * Applies a verification decision the BFF established with Persona. Only callers holding the
     * internal service token reach this path, so the decision is trusted as server-derived.
     */
    @Transactional
    public AppUser applyStatus(AppUser user, PersonaStatus status, String inquiryId) {
        String normalizedInquiryId = inquiryId == null || inquiryId.isBlank() ? null : inquiryId.trim();
        userRepository.updatePersonaStatus(user.id(), status, normalizedInquiryId);
        return userRepository.findById(user.id()).orElse(user);
    }
}
