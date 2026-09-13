package com.cashflowcopilot.cashevent;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * All queries are user-scoped and parameterized. Nothing here ever interpolates caller input
 * into SQL.
 */
@Repository
public class CashEventRepository {

    private static final String COLUMNS = """
            id, user_id, event_time, amount, direction, category, source, source_record_id,
            description, recurring, confidence, status, metadata
            """;

    private final JdbcClient jdbcClient;
    private final ObjectMapper objectMapper;

    public CashEventRepository(JdbcClient jdbcClient, ObjectMapper objectMapper) {
        this.jdbcClient = jdbcClient;
        this.objectMapper = objectMapper;
    }

    public List<CashEvent> findInRange(UUID userId, Instant from, Instant to) {
        return jdbcClient.sql("SELECT " + COLUMNS + """
                          FROM cash_events
                         WHERE user_id = ?
                           AND event_time >= ?
                           AND event_time <= ?
                         ORDER BY event_time ASC
                        """)
                .params(userId, Timestamp.from(from), Timestamp.from(to))
                .query(this::mapRow)
                .list();
    }

    /**
     * Outstanding money movements that shape the projection: everything still expected, plus
     * overdue items whose date has already passed.
     */
    public List<CashEvent> findOutstandingThrough(UUID userId, Instant horizonEnd) {
        return jdbcClient.sql("SELECT " + COLUMNS + """
                          FROM cash_events
                         WHERE user_id = ?
                           AND status IN ('EXPECTED', 'OVERDUE')
                           AND event_time <= ?
                         ORDER BY event_time ASC, id ASC
                        """)
                .params(userId, Timestamp.from(horizonEnd))
                .query(this::mapRow)
                .list();
    }

    public BigDecimal sumOutstanding(UUID userId, Direction direction, Instant from, Instant to) {
        return jdbcClient.sql("""
                        SELECT COALESCE(SUM(amount), 0)
                          FROM cash_events
                         WHERE user_id = ?
                           AND direction = ?
                           AND status IN ('EXPECTED', 'OVERDUE')
                           AND event_time <= ?
                           AND (status = 'OVERDUE' OR event_time >= ?)
                        """)
                .params(userId, direction.name(), Timestamp.from(to), Timestamp.from(from))
                .query(BigDecimal.class)
                .single();
    }

    public Optional<CashEvent> findBySourceRecord(UUID userId, CashEventSource source, String sourceRecordId) {
        return jdbcClient.sql("SELECT " + COLUMNS + """
                          FROM cash_events
                         WHERE user_id = ?
                           AND source = ?
                           AND source_record_id = ?
                         ORDER BY event_time DESC
                         LIMIT 1
                        """)
                .params(userId, source.name(), sourceRecordId)
                .query(this::mapRow)
                .optional();
    }

    public void insert(CashEvent event) {
        jdbcClient.sql("""
                        INSERT INTO cash_events (
                            id, user_id, event_time, amount, direction, category, source,
                            source_record_id, description, recurring, confidence, status, metadata)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb))
                        """)
                .params(
                        event.id(),
                        event.userId(),
                        Timestamp.from(event.eventTime()),
                        event.amount(),
                        event.direction().name(),
                        event.category(),
                        event.source().name(),
                        event.sourceRecordId(),
                        event.description(),
                        event.recurring(),
                        event.confidence(),
                        event.status().name(),
                        writeMetadata(event.metadata()))
                .update();
    }

    /**
     * Replaces an ingested event in place. The row is re-created because {@code event_time} is the
     * partitioning column on Timescale deployments.
     */
    public void replace(UUID existingId, Instant existingEventTime, CashEvent event) {
        jdbcClient.sql("DELETE FROM cash_events WHERE id = ? AND event_time = ?")
                .params(existingId, Timestamp.from(existingEventTime))
                .update();
        insert(event);
    }

    /**
     * Drops everything that came from a bank feed or was seeded next to one, identified by a source
     * record id. Document-derived events and manual entries without one are kept.
     */
    public int deleteIngested(UUID userId) {
        return jdbcClient.sql("""
                        DELETE FROM cash_events
                         WHERE user_id = ?
                           AND source IN ('NESSIE', 'MANUAL', 'SYSTEM')
                           AND source_record_id IS NOT NULL
                        """)
                .param(userId)
                .update();
    }

    public int countForUser(UUID userId) {
        return jdbcClient.sql("SELECT COUNT(*) FROM cash_events WHERE user_id = ?")
                .param(userId)
                .query(Integer.class)
                .single();
    }

    private String writeMetadata(Map<String, Object> metadata) {
        try {
            return objectMapper.writeValueAsString(metadata == null ? Map.of() : metadata);
        } catch (Exception e) {
            throw new IllegalArgumentException("Cash event metadata is not serialisable", e);
        }
    }

    private CashEvent mapRow(ResultSet rs, int rowNum) throws SQLException {
        String metadataJson = rs.getString("metadata");
        Map<String, Object> metadata;
        try {
            metadata = metadataJson == null
                    ? Map.of()
                    : objectMapper.readValue(metadataJson, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            metadata = Map.of();
        }
        Double confidence = rs.getObject("confidence") == null ? null : rs.getDouble("confidence");
        return new CashEvent(
                rs.getObject("id", UUID.class),
                rs.getObject("user_id", UUID.class),
                rs.getTimestamp("event_time").toInstant(),
                rs.getBigDecimal("amount"),
                Direction.valueOf(rs.getString("direction")),
                rs.getString("category"),
                CashEventSource.valueOf(rs.getString("source")),
                rs.getString("source_record_id"),
                rs.getString("description"),
                rs.getBoolean("recurring"),
                confidence,
                CashEventStatus.valueOf(rs.getString("status")),
                metadata);
    }
}
