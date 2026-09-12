package com.cashflowcopilot.auth;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cashflowcopilot.error.ApiException;
import com.cashflowcopilot.error.ErrorCode;
import com.cashflowcopilot.persona.PersonaStatus;
import com.cashflowcopilot.user.AppUser;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

class PersonaAccessGuardTest {

    private final PersonaAccessGuard guard = new PersonaAccessGuard();

    @Test
    void approvedUsersPass() {
        assertThatCode(() -> guard.requireApproved(userWith(PersonaStatus.APPROVED))).doesNotThrowAnyException();
    }

    @ParameterizedTest
    @EnumSource(value = PersonaStatus.class, names = {"UNVERIFIED", "PENDING", "DECLINED", "FAILED"})
    void everyOtherStatusIsRefused(PersonaStatus status) {
        assertThatThrownBy(() -> guard.requireApproved(userWith(status)))
                .isInstanceOf(ApiException.class)
                .satisfies(thrown -> org.assertj.core.api.Assertions
                        .assertThat(((ApiException) thrown).code())
                        .isEqualTo(ErrorCode.PERSONA_NOT_VERIFIED));
    }

    private static AppUser userWith(PersonaStatus status) {
        return new AppUser(
                UUID.randomUUID(),
                "subject",
                null,
                null,
                status,
                null,
                Instant.now(),
                Instant.now());
    }
}
