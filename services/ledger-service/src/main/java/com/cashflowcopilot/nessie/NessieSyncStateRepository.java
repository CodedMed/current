package com.cashflowcopilot.nessie;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class NessieSyncStateRepository {

    private final JdbcClient jdbcClient;

    public NessieSyncStateRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public Optional<String> findCustomerId(UUID userId) {
        return jdbcClient.sql("SELECT nessie_customer_id FROM nessie_sync_state WHERE user_id = ?")
                .param(userId)
                .query(String.class)
                .optional();
    }

    public Optional<Instant> findLastSyncedAt(UUID userId) {
        return jdbcClient.sql("SELECT last_synced_at FROM nessie_sync_state WHERE user_id = ?")
                .param(userId)
                .query(Timestamp.class)
                .optional()
                .map(Timestamp::toInstant);
    }

    public void recordSync(UUID userId, String customerId, Instant syncedAt, String status) {
        jdbcClient.sql("""
                        INSERT INTO nessie_sync_state (user_id, nessie_customer_id, last_synced_at, sync_status)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT (user_id) DO UPDATE
                            SET nessie_customer_id = EXCLUDED.nessie_customer_id,
                                last_synced_at = EXCLUDED.last_synced_at,
                                sync_status = EXCLUDED.sync_status
                        """)
                .params(userId, customerId, Timestamp.from(syncedAt), status)
                .update();
    }
}
