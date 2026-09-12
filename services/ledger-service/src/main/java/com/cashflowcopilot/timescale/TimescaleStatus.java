package com.cashflowcopilot.timescale;

/** What the connected database offers, as reported by {@link TimescaleSupport}. */
public record TimescaleStatus(
        boolean reachable,
        boolean available,
        String version,
        boolean cashEventsHypertable,
        boolean cashDailyAggregate,
        int backgroundJobs
) {

    /** The database did not answer at all. Not the same as "answered, but without timescaledb". */
    public static TimescaleStatus unreachable() {
        return new TimescaleStatus(false, false, null, false, false, 0);
    }

    /** Plain PostgreSQL: reachable, but the extension is not installed. */
    public static TimescaleStatus unavailable() {
        return new TimescaleStatus(true, false, null, false, false, 0);
    }

    /** True when the analytics service can read from the continuous aggregate. */
    public boolean aggregateReadable() {
        return available && cashDailyAggregate;
    }
}
