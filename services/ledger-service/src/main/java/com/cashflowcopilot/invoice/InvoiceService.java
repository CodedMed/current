package com.cashflowcopilot.invoice;

import com.cashflowcopilot.cashevent.CashEvent;
import com.cashflowcopilot.cashevent.CashEventRepository;
import com.cashflowcopilot.cashevent.CashEventSource;
import com.cashflowcopilot.cashevent.CashEventStatus;
import com.cashflowcopilot.cashevent.Direction;
import com.cashflowcopilot.error.ApiException;
import com.cashflowcopilot.error.ErrorCode;
import com.cashflowcopilot.invoice.InvoiceRiskRepository.InvoiceRisk;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InvoiceService {

    private final InvoiceRepository invoiceRepository;
    private final InvoiceRiskRepository riskRepository;
    private final CashEventRepository cashEventRepository;

    public InvoiceService(InvoiceRepository invoiceRepository, InvoiceRiskRepository riskRepository,
                          CashEventRepository cashEventRepository) {
        this.invoiceRepository = invoiceRepository;
        this.riskRepository = riskRepository;
        this.cashEventRepository = cashEventRepository;
    }

    @Transactional
    public Invoice create(UUID userId, CreateInvoiceRequest request) {
        Instant now = Instant.now();
        // Invoice views and the forecast must agree about whether the obligation is overdue.
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        LocalDate eventDate = request.dueDate() != null ? request.dueDate() : today;
        CashEventStatus status = eventDate.isBefore(today) ? CashEventStatus.OVERDUE : CashEventStatus.EXPECTED;
        Invoice invoice = new Invoice(UUID.randomUUID(), userId, request.vendorKey(),
                request.vendorDisplayName(), request.invoiceNumberHash(), request.amount(), request.previousAmount(),
                request.invoiceDate(), request.dueDate(), null, status.name(), request.recurring(),
                request.paymentDestinationFingerprint(), "DOCUMENT", request.confidence(), now);
        invoiceRepository.insert(invoice);
        // An undated obligation enters today's forecast, without inventing a due date on the invoice.
        // A due date already behind us is an overdue obligation, not a future one: it still
        // reduces the forecast, and it belongs in the overdue views rather than the upcoming ones.
        cashEventRepository.insert(new CashEvent(UUID.randomUUID(), userId,
                eventDate.atStartOfDay(ZoneOffset.UTC).toInstant(), request.amount(), Direction.OUT,
                request.category(), CashEventSource.DOCUMENT, invoice.id().toString(),
                request.vendorDisplayName() == null ? request.vendorKey() : request.vendorDisplayName(),
                request.recurring(), request.confidence(), status, Map.of()));
        return invoiceRepository.findById(userId, invoice.id()).orElseThrow();
    }

    public List<Invoice> list(UUID userId) {
        return invoiceRepository.findByUser(userId);
    }

    public Optional<Invoice> find(UUID userId, UUID invoiceId) {
        return invoiceRepository.findById(userId, invoiceId);
    }

    public List<InvoiceRisk> latestRisks(UUID userId) {
        return riskRepository.findLatestForUser(userId);
    }

    public Optional<InvoiceRisk> latestRisk(UUID userId, UUID invoiceId) {
        return riskRepository.findLatestForInvoice(userId, invoiceId);
    }

    /**
     * Stores a result from the Python risk engine. The score is recorded as-is: this service does
     * not recompute or reinterpret it, it only checks the invoice belongs to the caller.
     */
    @Transactional
    public InvoiceRisk storeRisk(
            UUID userId,
            UUID invoiceId,
            double riskScore,
            String severity,
            double rulesScore,
            Double mlScore,
            List<String> reasons,
            String modelVersion) {
        invoiceRepository.findById(userId, invoiceId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Invoice not found."));
        riskRepository.insert(invoiceId, riskScore, severity, rulesScore, mlScore, reasons, modelVersion);
        return riskRepository.findLatestForInvoice(userId, invoiceId).orElseThrow();
    }
}
