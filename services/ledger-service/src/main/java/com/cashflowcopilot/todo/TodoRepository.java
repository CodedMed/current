package com.cashflowcopilot.todo;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class TodoRepository {

    private static final String COLUMNS = """
            id, user_id, title, description, source, status, priority, due_date,
            recommendation_id, metadata, created_at, updated_at
            """;

    private final JdbcClient jdbcClient;
    private final ObjectMapper objectMapper;

    public TodoRepository(JdbcClient jdbcClient, ObjectMapper objectMapper) {
        this.jdbcClient = jdbcClient;
        this.objectMapper = objectMapper;
    }

    public List<TodoItem> findByUser(UUID userId) {
        return jdbcClient.sql("SELECT " + COLUMNS + """
                          FROM todo_items
                         WHERE user_id = ?
                         ORDER BY created_at DESC
                        """)
                .param(userId)
                .query(this::mapRow)
                .list();
    }

    public List<TodoItem> findOpenByUser(UUID userId) {
        return jdbcClient.sql("SELECT " + COLUMNS + """
                          FROM todo_items
                         WHERE user_id = ?
                           AND status IN ('PROPOSED', 'APPROVED', 'IN_PROGRESS')
                         ORDER BY CASE priority WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
                                  due_date NULLS LAST
                        """)
                .param(userId)
                .query(this::mapRow)
                .list();
    }

    public Optional<TodoItem> findById(UUID userId, UUID id) {
        return jdbcClient.sql("SELECT " + COLUMNS + " FROM todo_items WHERE user_id = ? AND id = ?")
                .params(userId, id)
                .query(this::mapRow)
                .optional();
    }

    public void insert(TodoItem item) {
        jdbcClient.sql("""
                        INSERT INTO todo_items (
                            id, user_id, title, description, source, status, priority, due_date,
                            recommendation_id, metadata)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb))
                        """)
                .params(
                        item.id(),
                        item.userId(),
                        item.title(),
                        item.description(),
                        item.source().name(),
                        item.status().name(),
                        item.priority().name(),
                        item.dueDate() == null ? null : Date.valueOf(item.dueDate()),
                        item.recommendationId(),
                        writeMetadata(item.metadata()))
                .update();
    }

    public void update(TodoItem item) {
        jdbcClient.sql("""
                        UPDATE todo_items
                           SET title = ?,
                               description = ?,
                               status = ?,
                               priority = ?,
                               due_date = ?,
                               metadata = CAST(? AS jsonb),
                               updated_at = now()
                         WHERE user_id = ? AND id = ?
                        """)
                .params(
                        item.title(),
                        item.description(),
                        item.status().name(),
                        item.priority().name(),
                        item.dueDate() == null ? null : Date.valueOf(item.dueDate()),
                        writeMetadata(item.metadata()),
                        item.userId(),
                        item.id())
                .update();
    }

    public int delete(UUID userId, UUID id) {
        return jdbcClient.sql("DELETE FROM todo_items WHERE user_id = ? AND id = ?")
                .params(userId, id)
                .update();
    }

    public int countForUser(UUID userId) {
        return jdbcClient.sql("SELECT COUNT(*) FROM todo_items WHERE user_id = ?")
                .param(userId)
                .query(Integer.class)
                .single();
    }

    private String writeMetadata(Map<String, Object> metadata) {
        try {
            return objectMapper.writeValueAsString(metadata == null ? Map.of() : metadata);
        } catch (Exception e) {
            throw new IllegalArgumentException("Task metadata is not serialisable", e);
        }
    }

    private TodoItem mapRow(ResultSet rs, int rowNum) throws SQLException {
        Map<String, Object> metadata;
        try {
            String json = rs.getString("metadata");
            metadata = json == null
                    ? Map.of()
                    : objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            metadata = Map.of();
        }
        Date dueDate = rs.getDate("due_date");
        LocalDate due = dueDate == null ? null : dueDate.toLocalDate();
        return new TodoItem(
                rs.getObject("id", UUID.class),
                rs.getObject("user_id", UUID.class),
                rs.getString("title"),
                rs.getString("description"),
                TodoSource.valueOf(rs.getString("source")),
                TodoStatus.valueOf(rs.getString("status")),
                TodoPriority.valueOf(rs.getString("priority")),
                due,
                rs.getObject("recommendation_id", UUID.class),
                metadata,
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }
}
