package com.cashflowcopilot.user;

import com.cashflowcopilot.config.AppProperties;
import com.cashflowcopilot.persona.PersonaStatus;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final AppProperties properties;

    public UserService(UserRepository userRepository, AppProperties properties) {
        this.userRepository = userRepository;
        this.properties = properties;
    }

    /**
     * Maps the external auth subject forwarded by the BFF onto an application user. In demo mode
     * the seeded demo subject starts out approved so the walkthrough needs no Persona credentials.
     */
    @Transactional
    public AppUser findOrCreateBySubject(String subject) {
        return userRepository.findBySubject(subject)
                .orElseGet(() -> userRepository.insert(
                        UUID.randomUUID(),
                        subject,
                        null,
                        null,
                        initialStatusFor(subject)));
    }

    private PersonaStatus initialStatusFor(String subject) {
        boolean demoSubject = properties.demoMode() && subject.equals(properties.demoAuthSubject());
        return demoSubject ? PersonaStatus.APPROVED : PersonaStatus.UNVERIFIED;
    }
}
