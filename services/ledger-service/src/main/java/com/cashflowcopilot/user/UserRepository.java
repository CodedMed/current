package com.cashflowcopilot.user;

import com.cashflowcopilot.persona.PersonaStatus;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class UserRepository {

    private static final String COLUMNS =
            "id, external_auth_subject, email, display_name, persona_status, persona_inquiry_id, created_at, updated_at";

    private final JdbcClient jdbcClient;

    public UserRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public Optional<AppUser> findBySubject(String subject) {
        return jdbcClient.sql("SELECT " + COLUMNS + " FROM app_users WHERE external_auth_subject = ?")
                .param(subject)
                .query(UserRepository::mapRow)
                .optional();
    }

    public Optional<AppUser> findById(UUID id) {
        return jdbcClient.sql("SELECT " + COLUMNS + " FROM app_users WHERE id = ?")
                .param(id)
                .query(UserRepository::mapRow)
                .optional();
    }

    public AppUser insert(UUID id, String subject, String email, String displayName, PersonaStatus status) {
        jdbcClient.sql("""
                        INSERT INTO app_users (id, external_auth_subject, email, display_name, persona_status)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT (external_auth_subject) DO NOTHING
                        """)
                .params(id, subject, email, displayName, status.storageValue())
                .update();
        return findBySubject(subject).orElseThrow();
    }

    public void updatePersonaStatus(UUID userId, PersonaStatus status, String inquiryId) {
        jdbcClient.sql("""
                        UPDATE app_users
                           SET persona_status = ?,
                               persona_inquiry_id = COALESCE(?, persona_inquiry_id),
                               updated_at = now()
                         WHERE id = ?
                        """)
                .params(status.storageValue(), inquiryId, userId)
                .update();
    }

    /** Fills in the sign-in profile the BFF forwards; a null keeps whatever is already stored. */
    public void updateProfile(UUID userId, String email, String displayName) {
        jdbcClient.sql("""
                        UPDATE app_users
                           SET email = COALESCE(?, email),
                               display_name = COALESCE(?, display_name),
                               updated_at = now()
                         WHERE id = ?
                        """)
                .params(email, displayName, userId)
                .update();
    }

    public Optional<AppUser> findByPersonaReferenceId(String referenceId) {
        try {
            return findById(UUID.fromString(referenceId));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    private static AppUser mapRow(ResultSet rs, int rowNum) throws SQLException {
        return new AppUser(
                rs.getObject("id", UUID.class),
                rs.getString("external_auth_subject"),
                rs.getString("email"),
                rs.getString("display_name"),
                PersonaStatus.fromStorage(rs.getString("persona_status")),
                rs.getString("persona_inquiry_id"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }
}
