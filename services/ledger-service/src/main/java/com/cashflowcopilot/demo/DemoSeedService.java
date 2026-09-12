package com.cashflowcopilot.demo;

import com.cashflowcopilot.cashevent.CashEvent;
import com.cashflowcopilot.cashevent.CashEventService;
import com.cashflowcopilot.cashevent.CashEventSource;
import com.cashflowcopilot.cashevent.CashEventStatus;
import com.cashflowcopilot.cashevent.Direction;
import com.cashflowcopilot.config.AppProperties;
import com.cashflowcopilot.error.ApiException;
import com.cashflowcopilot.error.ErrorCode;
import com.cashflowcopilot.invoice.Invoice;
import com.cashflowcopilot.invoice.InvoiceRepository;
import com.cashflowcopilot.nessie.NessieSyncService;
import com.cashflowcopilot.todo.TodoPriority;
import com.cashflowcopilot.todo.TodoService;
import com.cashflowcopilot.todo.TodoSource;
import com.cashflowcopilot.todo.TodoStatus;
import com.cashflowcopilot.user.AppUser;
import com.cashflowcopilot.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Loads the demo business described in {@code samples/seed/demo_ledger.json} plus the mock bank
 * feed, so the product tells a complete story with no sponsor credentials.
 *
 * <p>Only runs while {@code DEMO_MODE=true}. At startup it seeds the built-in demo subject; the
 * BFF can also seed any other verified user through {@code POST /v1/demo/seed}, which is how a
 * freshly signed-in demo user gets the same business. Seeding is idempotent: a user who already
 * has data is left untouched.
 */
@Component
public class DemoSeedService implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoSeedService.class);
    private static final String FIXTURE = "samples/seed/demo_ledger.json";

    private final AppProperties properties;
    private final UserService userService;
    private final NessieSyncService nessieSyncService;
    private final CashEventService cashEventService;
    private final InvoiceRepository invoiceRepository;
    private final TodoService todoService;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public DemoSeedService(
            AppProperties properties,
            UserService userService,
            NessieSyncService nessieSyncService,
            CashEventService cashEventService,
            InvoiceRepository invoiceRepository,
            TodoService todoService,
            ObjectMapper objectMapper,
            Clock clock) {
        this.properties = properties;
        this.userService = userService;
        this.nessieSyncService = nessieSyncService;
        this.cashEventService = cashEventService;
        this.invoiceRepository = invoiceRepository;
        this.todoService = todoService;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!properties.demoMode()) {
            return;
        }
        AppUser user = userService.findOrCreateBySubject(properties.demoAuthSubject());
        SeedResult result = seedIfEmpty(user);
        if (result.seeded()) {
            log.info("Demo seed for {}: {} bank events, {} ledger events, {} invoices, {} tasks",
                    properties.demoAuthSubject(), result.bankEvents(), result.ledgerEvents(),
                    result.invoices(), result.todos());
        }
    }

    /**
     * Seeds the demo business for {@code user} unless they already have ledger data. Refused
     * outside demo mode so no fixture can ever land in a real ledger.
     */
    @Transactional
    public SeedResult seedIfEmpty(AppUser user) {
        if (!properties.demoMode()) {
            throw new ApiException(ErrorCode.NOT_IMPLEMENTED, "Demo seeding is disabled outside demo mode.");
        }
        int bankEvents = 0;
        int ledgerEvents = 0;
        int invoices = 0;
        int todos = 0;
        boolean seededLedger = false;

        if (cashEventService.countForUser(user.id()) == 0) {
            try {
                NessieSyncService.SyncResult sync = nessieSyncService.sync(user);
                bankEvents = sync.insertedEvents();
            } catch (ApiException e) {
                // A live client pointed at a customer the sandbox does not have must not stop the
                // demo business from existing; bank data can still be synced later.
                log.warn("Demo seed: bank sync skipped ({}).", e.getMessage());
            }
            LedgerCounts counts = seedLedger(user);
            ledgerEvents = counts.events();
            invoices = counts.invoices();
            seededLedger = true;
        }
        if (todoService.countForUser(user.id()) == 0) {
            todos = seedTodos(user);
        }
        return new SeedResult(seededLedger || todos > 0, bankEvents, ledgerEvents, invoices, todos);
    }

    private LedgerCounts seedLedger(AppUser user) {
        JsonNode fixture = readFixture();
        int events = 0;

        for (JsonNode node : fixture.withArray("receivables")) {
            CashEvent event = CashEventService.newEvent(
                    user.id(),
                    atOffset(node.path("dueDayOffset").asInt()),
                    node.path("amount").decimalValue(),
                    Direction.IN,
                    "client_invoice",
                    CashEventSource.MANUAL,
                    node.path("sourceRecordId").asText(),
                    node.path("description").asText(),
                    false,
                    CashEventStatus.valueOf(node.path("status").asText("EXPECTED")),
                    Map.of("counterpartyLabel", node.path("counterpartyLabel").asText()));
            cashEventService.upsertBySourceRecord(event);
            events++;
        }

        for (JsonNode node : fixture.withArray("obligations")) {
            CashEvent event = CashEventService.newEvent(
                    user.id(),
                    atOffset(node.path("dueDayOffset").asInt()),
                    node.path("amount").decimalValue(),
                    Direction.OUT,
                    node.path("category").asText(),
                    CashEventSource.SYSTEM,
                    node.path("sourceRecordId").asText(),
                    node.path("description").asText(),
                    false,
                    CashEventStatus.EXPECTED,
                    Map.of());
            cashEventService.upsertBySourceRecord(event);
            events++;
        }

        int invoices = 0;
        for (JsonNode node : fixture.withArray("vendorInvoices")) {
            Invoice invoice = new Invoice(
                    UUID.randomUUID(),
                    user.id(),
                    node.path("vendorKey").asText(),
                    node.path("vendorDisplayName").asText(),
                    node.path("invoiceNumberHash").asText(null),
                    node.path("amount").decimalValue(),
                    node.hasNonNull("previousAmount") ? node.path("previousAmount").decimalValue() : null,
                    localDateAt(node, "invoiceDayOffset"),
                    localDateAt(node, "dueDayOffset"),
                    localDateAt(node, "paidDayOffset"),
                    node.path("status").asText(),
                    node.path("recurring").asBoolean(false),
                    node.path("paymentDestinationFingerprint").asText(null),
                    "SEED",
                    null,
                    Instant.now(clock));
            invoiceRepository.insert(invoice);
            invoices++;

            if (node.path("createsCashEvent").asBoolean(false)) {
                Map<String, Object> metadata = new HashMap<>();
                metadata.put("invoiceId", invoice.id().toString());
                metadata.put("counterpartyLabel", invoice.vendorDisplayName());
                CashEvent event = CashEventService.newEvent(
                        user.id(),
                        atOffset(node.path("dueDayOffset").asInt()),
                        invoice.amount(),
                        Direction.OUT,
                        node.path("category").asText(),
                        CashEventSource.DOCUMENT,
                        node.path("sourceRecordId").asText(),
                        invoice.vendorDisplayName() + " invoice",
                        invoice.recurring(),
                        CashEventStatus.EXPECTED,
                        metadata);
                cashEventService.upsertBySourceRecord(event);
                events++;
            }
        }
        return new LedgerCounts(events, invoices);
    }

    private int seedTodos(AppUser user) {
        int count = 0;
        for (JsonNode node : readFixture().withArray("todos")) {
            todoService.create(
                    user.id(),
                    node.path("title").asText(),
                    node.path("description").asText(),
                    TodoSource.valueOf(node.path("source").asText("MANUAL")),
                    TodoStatus.valueOf(node.path("status").asText("PROPOSED")),
                    TodoPriority.valueOf(node.path("priority").asText("MEDIUM")),
                    localDateAt(node, "dueDayOffset"),
                    null,
                    Map.of());
            count++;
        }
        return count;
    }

    private JsonNode readFixture() {
        try (InputStream stream = new ClassPathResource(FIXTURE).getInputStream()) {
            return objectMapper.readTree(stream);
        } catch (IOException e) {
            throw new IllegalStateException("Demo fixture " + FIXTURE + " could not be read", e);
        }
    }

    private LocalDate today() {
        return Instant.now(clock).atZone(ZoneOffset.UTC).toLocalDate();
    }

    private Instant atOffset(int dayOffset) {
        return LocalTime.NOON.atDate(today().plusDays(dayOffset)).toInstant(ZoneOffset.UTC);
    }

    private LocalDate localDateAt(JsonNode node, String field) {
        return node.hasNonNull(field) ? today().plusDays(node.path(field).asInt()) : null;
    }

    private record LedgerCounts(int events, int invoices) {}

    /** What a seed call did. {@code seeded} is false when the user already had data. */
    public record SeedResult(boolean seeded, int bankEvents, int ledgerEvents, int invoices, int todos) {}
}
