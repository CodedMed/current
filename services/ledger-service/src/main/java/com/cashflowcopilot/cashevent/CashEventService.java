package com.cashflowcopilot.cashevent;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CashEventService {

    private final CashEventRepository repository;

    public CashEventService(CashEventRepository repository) {
        this.repository = repository;
    }

    public List<CashEvent> listInRange(UUID userId, Instant from, Instant to) {
        return repository.findInRange(userId, from, to);
    }

    public List<CashEvent> outstandingThrough(UUID userId, Instant horizonEnd) {
        return repository.findOutstandingThrough(userId, horizonEnd);
    }

    public BigDecimal sumOutstanding(UUID userId, Direction direction, Instant from, Instant to) {
        return repository.sumOutstanding(userId, direction, from, to);
    }

    @Transactional
    public CashEvent create(CashEvent event) {
        repository.insert(event);
        return event;
    }

    /**
     * Idempotent ingest keyed on the upstream record id.
     *
     * @return true when a new row was created, false when an existing row was replaced
     */
    @Transactional
    public boolean upsertBySourceRecord(CashEvent event) {
        if (event.sourceRecordId() == null) {
            repository.insert(event);
            return true;
        }
        Optional<CashEvent> existing =
                repository.findBySourceRecord(event.userId(), event.source(), event.sourceRecordId());
        if (existing.isEmpty()) {
            repository.insert(event);
            return true;
        }
        CashEvent previous = existing.get();
        CashEvent replacement = new CashEvent(
                previous.id(),
                event.userId(),
                event.eventTime(),
                event.amount(),
                event.direction(),
                event.category(),
                event.source(),
                event.sourceRecordId(),
                event.description(),
                event.recurring(),
                event.confidence(),
                event.status(),
                event.metadata());
        repository.replace(previous.id(), previous.eventTime(), replacement);
        return false;
    }

    public static CashEvent newEvent(
            UUID userId,
            Instant eventTime,
            BigDecimal amount,
            Direction direction,
            String category,
            CashEventSource source,
            String sourceRecordId,
            String description,
            boolean recurring,
            CashEventStatus status,
            Map<String, Object> metadata) {
        return new CashEvent(
                UUID.randomUUID(),
                userId,
                eventTime,
                amount,
                direction,
                category,
                source,
                sourceRecordId,
                description,
                recurring,
                null,
                status,
                metadata == null ? Map.of() : metadata);
    }

    public int countForUser(UUID userId) {
        return repository.countForUser(userId);
    }
}
