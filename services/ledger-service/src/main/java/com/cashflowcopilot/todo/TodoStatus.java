package com.cashflowcopilot.todo;

import java.util.Set;

public enum TodoStatus {
    PROPOSED,
    APPROVED,
    DECLINED,
    IN_PROGRESS,
    COMPLETED;

    private static final Set<TodoStatus> OPEN = Set.of(PROPOSED, APPROVED, IN_PROGRESS);

    public boolean isOpen() {
        return OPEN.contains(this);
    }

    /**
     * Advisor proposals are never auto-executed: a proposal must be approved or declined before it
     * can progress, and finished work is terminal.
     */
    public boolean canTransitionTo(TodoStatus next) {
        if (this == next) {
            return true;
        }
        return switch (this) {
            case PROPOSED -> next == APPROVED || next == DECLINED;
            case APPROVED -> next == IN_PROGRESS || next == COMPLETED || next == DECLINED;
            case IN_PROGRESS -> next == COMPLETED || next == DECLINED;
            case DECLINED, COMPLETED -> false;
        };
    }
}
