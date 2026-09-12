package com.cashflowcopilot.cashevent;

public enum CashEventStatus {
    /** Money that has already moved. */
    ACTUAL,
    /** Money expected to move on the event date. */
    EXPECTED,
    /** Expected money whose date has passed without settling. */
    OVERDUE,
    /** Withdrawn: never affects the forecast. */
    CANCELLED;

    /** Overdue items are still outstanding, so they belong in the projection. */
    public boolean affectsForecast() {
        return this == EXPECTED || this == OVERDUE;
    }
}
