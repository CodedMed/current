package com.cashflowcopilot.todo;

import com.cashflowcopilot.auth.CurrentUser;
import com.cashflowcopilot.user.AppUser;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/todos")
public class TodoController {

    private final TodoService todoService;

    public TodoController(TodoService todoService) {
        this.todoService = todoService;
    }

    @GetMapping
    public List<TodoDto> list(@CurrentUser AppUser user) {
        return todoService.list(user.id()).stream().map(TodoDto::from).toList();
    }

    @PostMapping
    public TodoDto create(@CurrentUser AppUser user, @Valid @RequestBody CreateTodoRequest request) {
        return TodoDto.from(todoService.create(
                user.id(),
                request.title(),
                request.description(),
                request.source(),
                request.status(),
                request.priority(),
                request.dueDate(),
                request.recommendationId(),
                request.metadata()));
    }

    @PatchMapping("/{id}")
    public TodoDto update(
            @CurrentUser AppUser user,
            @PathVariable UUID id,
            @RequestBody UpdateTodoRequest request) {
        return TodoDto.from(todoService.update(
                user.id(),
                id,
                request.title(),
                request.description(),
                request.status(),
                request.priority(),
                request.dueDate(),
                request.hasDueDate()));
    }

    @DeleteMapping("/{id}")
    public void delete(@CurrentUser AppUser user, @PathVariable UUID id) {
        todoService.delete(user.id(), id);
    }

    public record CreateTodoRequest(
            @NotBlank String title,
            String description,
            TodoSource source,
            TodoStatus status,
            TodoPriority priority,
            LocalDate dueDate,
            UUID recommendationId,
            Map<String, Object> metadata
    ) {}

    /** PATCH must distinguish an omitted due date from an explicit null (clear the date). */
    public static final class UpdateTodoRequest {
        @JsonProperty private String title;
        @JsonProperty private String description;
        @JsonProperty private TodoStatus status;
        @JsonProperty private TodoPriority priority;
        private LocalDate dueDate;
        private boolean hasDueDate;

        @JsonSetter("dueDate")
        public void setDueDate(LocalDate dueDate) {
            this.dueDate = dueDate;
            this.hasDueDate = true;
        }

        public String title() { return title; }
        public String description() { return description; }
        public TodoStatus status() { return status; }
        public TodoPriority priority() { return priority; }
        public LocalDate dueDate() { return dueDate; }
        public boolean hasDueDate() { return hasDueDate; }
    }

    public record TodoDto(
            UUID id,
            String title,
            String description,
            TodoSource source,
            TodoStatus status,
            TodoPriority priority,
            LocalDate dueDate,
            Map<String, Object> metadata,
            Instant createdAt,
            Instant updatedAt
    ) {
        static TodoDto from(TodoItem item) {
            return new TodoDto(
                    item.id(),
                    item.title(),
                    item.description(),
                    item.source(),
                    item.status(),
                    item.priority(),
                    item.dueDate(),
                    item.metadata(),
                    item.createdAt(),
                    item.updatedAt());
        }
    }
}
