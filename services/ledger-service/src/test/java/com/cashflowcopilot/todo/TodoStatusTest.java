package com.cashflowcopilot.todo;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class TodoStatusTest {

    @Test
    void proposalsMustBeApprovedOrDeclinedFirst() {
        assertThat(TodoStatus.PROPOSED.canTransitionTo(TodoStatus.APPROVED)).isTrue();
        assertThat(TodoStatus.PROPOSED.canTransitionTo(TodoStatus.DECLINED)).isTrue();
        assertThat(TodoStatus.PROPOSED.canTransitionTo(TodoStatus.COMPLETED)).isFalse();
        assertThat(TodoStatus.PROPOSED.canTransitionTo(TodoStatus.IN_PROGRESS)).isFalse();
    }

    @Test
    void approvedWorkCanProgressOrFinish() {
        assertThat(TodoStatus.APPROVED.canTransitionTo(TodoStatus.IN_PROGRESS)).isTrue();
        assertThat(TodoStatus.IN_PROGRESS.canTransitionTo(TodoStatus.COMPLETED)).isTrue();
    }

    @Test
    void terminalStatusesDoNotReopen() {
        assertThat(TodoStatus.COMPLETED.canTransitionTo(TodoStatus.IN_PROGRESS)).isFalse();
        assertThat(TodoStatus.DECLINED.canTransitionTo(TodoStatus.APPROVED)).isFalse();
    }

    @Test
    void openStatusesAreTheOnesStillNeedingAttention() {
        assertThat(TodoStatus.PROPOSED.isOpen()).isTrue();
        assertThat(TodoStatus.APPROVED.isOpen()).isTrue();
        assertThat(TodoStatus.IN_PROGRESS.isOpen()).isTrue();
        assertThat(TodoStatus.COMPLETED.isOpen()).isFalse();
        assertThat(TodoStatus.DECLINED.isOpen()).isFalse();
    }
}
