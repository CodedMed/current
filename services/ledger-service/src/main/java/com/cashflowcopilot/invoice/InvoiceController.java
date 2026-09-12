package com.cashflowcopilot.invoice;

import com.cashflowcopilot.auth.CurrentUser;
import com.cashflowcopilot.error.ApiException;
import com.cashflowcopilot.error.ErrorCode;
import com.cashflowcopilot.invoice.InvoiceRiskRepository.InvoiceRisk;
import com.cashflowcopilot.user.AppUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/invoices")
public class InvoiceController {

    private final InvoiceService invoiceService;

    public InvoiceController(InvoiceService invoiceService) {
        this.invoiceService = invoiceService;
    }

    @GetMapping
    public List<InvoiceDto> list(@CurrentUser AppUser user) {
        Map<UUID, InvoiceRisk> risks = invoiceService.latestRisks(user.id()).stream()
                .collect(Collectors.toMap(InvoiceRisk::invoiceId, Function.identity()));
        return invoiceService.list(user.id()).stream()
                .map(invoice -> InvoiceDto.from(invoice, risks.get(invoice.id())))
                .toList();
    }

    @GetMapping("/{id}")
    public InvoiceDto get(@CurrentUser AppUser user, @PathVariable UUID id) {
        Invoice invoice = invoiceService.find(user.id(), id)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Invoice not found."));
        return InvoiceDto.from(invoice, invoiceService.latestRisk(user.id(), id).orElse(null));
    }

    @PostMapping
    public InvoiceDto create(@CurrentUser AppUser user, @Valid @RequestBody CreateInvoiceRequest request) {
        return InvoiceDto.from(invoiceService.create(user.id(), request), null);
    }

    /** Stores the Python risk engine's output for this invoice. The latest result wins. */
    @PostMapping("/{id}/risk-result")
    public RiskResultDto storeRiskResult(
            @CurrentUser AppUser user,
            @PathVariable UUID id,
            @Valid @RequestBody RiskResultRequest request) {
        InvoiceRisk stored = invoiceService.storeRisk(
                user.id(),
                id,
                request.riskScore(),
                request.severity(),
                request.rulesScore(),
                request.mlScore(),
                request.reasons() == null ? List.of() : request.reasons(),
                request.modelVersion());
        return RiskResultDto.from(stored);
    }

    /** Mirrors the intelligence service's {@code RiskResponse}; every field is validated. */
    public record RiskResultRequest(
            @NotNull @DecimalMin("0") @DecimalMax("1") Double riskScore,
            @NotBlank @Pattern(regexp = "LOW|MEDIUM|HIGH") String severity,
            @NotNull @DecimalMin("0") @DecimalMax("1") Double rulesScore,
            @DecimalMin("0") @DecimalMax("1") Double mlScore,
            @Size(max = 20) List<@NotBlank @Size(max = 500) String> reasons,
            @NotBlank @Size(max = 100) String modelVersion
    ) {}

    public record RiskResultDto(
            UUID invoiceId,
            String vendorLabel,
            double riskScore,
            String severity,
            double rulesScore,
            Double mlScore,
            List<String> reasons,
            String modelVersion
    ) {
        static RiskResultDto from(InvoiceRisk risk) {
            return new RiskResultDto(
                    risk.invoiceId(),
                    risk.vendorLabel(),
                    risk.riskScore(),
                    risk.severity(),
                    risk.rulesScore(),
                    risk.mlScore(),
                    risk.reasons(),
                    risk.modelVersion());
        }
    }

    public record InvoiceDto(
            UUID id,
            String vendorKey,
            String vendorDisplayName,
            BigDecimal amount,
            BigDecimal previousAmount,
            LocalDate invoiceDate,
            LocalDate dueDate,
            LocalDate paidDate,
            String status,
            boolean recurring,
            String source,
            String invoiceNumberHash,
            /** Non-reversible hash of the payment destination; feeds the risk engine's history. */
            String paymentDestinationFingerprint,
            Double riskScore,
            String riskSeverity,
            List<String> riskReasons
    ) {
        static InvoiceDto from(Invoice invoice, InvoiceRisk risk) {
            return new InvoiceDto(
                    invoice.id(),
                    invoice.vendorKey(),
                    invoice.vendorDisplayName(),
                    invoice.amount(),
                    invoice.previousAmount(),
                    invoice.invoiceDate(),
                    invoice.dueDate(),
                    invoice.paidDate(),
                    invoice.status(),
                    invoice.recurring(),
                    invoice.source(),
                    invoice.invoiceNumberHash(),
                    invoice.paymentDestinationFingerprint(),
                    risk == null ? null : risk.riskScore(),
                    risk == null ? null : risk.severity(),
                    risk == null ? List.of() : risk.reasons());
        }
    }
}
