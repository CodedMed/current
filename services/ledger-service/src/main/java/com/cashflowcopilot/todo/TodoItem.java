package com.cashflowcopilot.todo;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

public record TodoItem(
        UUID id,
        UUID userId,
        String title,
        String description,
        TodoSource source,
        TodoStatus status,
        TodoPriority priority,
        LocalDate dueDate,
        UUID recommendationId,
        Map<String, Object> metadata,
        Instant createdAt,
        Instant updatedAt
) {}
