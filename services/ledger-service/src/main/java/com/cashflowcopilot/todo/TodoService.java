package com.cashflowcopilot.todo;

import com.cashflowcopilot.error.ApiException;
import com.cashflowcopilot.error.ErrorCode;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TodoService {

    private final TodoRepository repository;

    public TodoService(TodoRepository repository) {
        this.repository = repository;
    }

    public List<TodoItem> list(UUID userId) {
        return repository.findByUser(userId);
    }

    public List<TodoItem> listOpen(UUID userId) {
        return repository.findOpenByUser(userId);
    }

    @Transactional
    public TodoItem create(
            UUID userId,
            String title,
            String description,
            TodoSource source,
            TodoStatus status,
            TodoPriority priority,
            LocalDate dueDate,
            UUID recommendationId,
            Map<String, Object> metadata) {

        TodoItem item = new TodoItem(
                UUID.randomUUID(),
                userId,
                title,
                description,
                source == null ? TodoSource.MANUAL : source,
                status == null ? defaultStatusFor(source) : status,
                priority == null ? TodoPriority.MEDIUM : priority,
                dueDate,
                recommendationId,
                metadata == null ? Map.of() : metadata,
                null,
                null);
        repository.insert(item);
        return repository.findById(userId, item.id()).orElseThrow();
    }

    @Transactional
    public TodoItem update(
            UUID userId,
            UUID id,
            String title,
            String description,
            TodoStatus status,
            TodoPriority priority,
            LocalDate dueDate) {

        TodoItem existing = repository.findById(userId, id)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Task not found."));

        TodoStatus nextStatus = status == null ? existing.status() : status;
        if (!existing.status().canTransitionTo(nextStatus)) {
            throw new ApiException(
                    ErrorCode.INVALID_FINANCIAL_DATA,
                    "A task cannot move from %s to %s.".formatted(existing.status(), nextStatus));
        }

        TodoItem updated = new TodoItem(
                existing.id(),
                existing.userId(),
                title == null ? existing.title() : title,
                description == null ? existing.description() : description,
                existing.source(),
                nextStatus,
                priority == null ? existing.priority() : priority,
                dueDate == null ? existing.dueDate() : dueDate,
                existing.recommendationId(),
                existing.metadata(),
                existing.createdAt(),
                existing.updatedAt());
        repository.update(updated);
        return repository.findById(userId, id).orElseThrow();
    }

    @Transactional
    public void delete(UUID userId, UUID id) {
        if (repository.delete(userId, id) == 0) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Task not found.");
        }
    }

    public int countForUser(UUID userId) {
        return repository.countForUser(userId);
    }

    /** Anything the system proposes starts as a proposal awaiting approval. */
    private TodoStatus defaultStatusFor(TodoSource source) {
        return source == TodoSource.MANUAL ? TodoStatus.APPROVED : TodoStatus.PROPOSED;
    }
}
