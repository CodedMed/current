package com.cashflowcopilot.invoice;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * Risk results per invoice. Rows are written by the BFF from the Python risk engine's output;
 * this service never scores anything itself. Reads always return the latest row per invoice.
 */
@Repository
public class InvoiceRiskRepository {

    private static final String COLUMNS_AND_JOIN = """
            r.invoice_id, r.risk_score, r.severity, r.rules_score, r.ml_score,
            r.reasons, r.model_version, i.vendor_display_name, i.vendor_key
              FROM invoice_risks r
              JOIN invoices i ON i.id = r.invoice_id
            """;

    private final JdbcClient jdbcClient;
    private final ObjectMapper objectMapper;

    public InvoiceRiskRepository(JdbcClient jdbcClient, ObjectMapper objectMapper) {
        this.jdbcClient = jdbcClient;
        this.objectMapper = objectMapper;
    }

    public List<InvoiceRisk> findLatestForUser(UUID userId) {
        return jdbcClient.sql("SELECT DISTINCT ON (r.invoice_id) " + COLUMNS_AND_JOIN + """
                         WHERE i.user_id = ?
                         ORDER BY r.invoice_id, r.created_at DESC
                        """)
                .param(userId)
                .query(this::mapRow)
                .list();
    }

    public Optional<InvoiceRisk> findLatestForInvoice(UUID userId, UUID invoiceId) {
        return jdbcClient.sql("SELECT " + COLUMNS_AND_JOIN + """
                         WHERE i.user_id = ? AND r.invoice_id = ?
                         ORDER BY r.created_at DESC
                         LIMIT 1
                        """)
                .params(userId, invoiceId)
                .query(this::mapRow)
                .optional();
    }

    public void insert(
            UUID invoiceId,
            double riskScore,
            String severity,
            double rulesScore,
            Double mlScore,
            List<String> reasons,
            String modelVersion) {
        jdbcClient.sql("""
                        INSERT INTO invoice_risks (
                            id, invoice_id, risk_score, severity, rules_score, ml_score, reasons, model_version)
                        VALUES (?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?)
                        """)
                .params(
                        UUID.randomUUID(),
                        invoiceId,
                        riskScore,
                        severity,
                        rulesScore,
                        mlScore,
                        writeReasons(reasons),
                        modelVersion)
                .update();
    }

    private String writeReasons(List<String> reasons) {
        try {
            return objectMapper.writeValueAsString(reasons == null ? List.of() : reasons);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Risk reasons are not serialisable", e);
        }
    }

    private InvoiceRisk mapRow(ResultSet rs, int rowNum) throws SQLException {
        List<String> reasons;
        try {
            String json = rs.getString("reasons");
            reasons = json == null ? List.of() : objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            reasons = List.of();
        }
        Double mlScore = rs.getObject("ml_score") == null ? null : rs.getDouble("ml_score");
        String vendorLabel = rs.getString("vendor_display_name") != null
                ? rs.getString("vendor_display_name")
                : rs.getString("vendor_key");
        return new InvoiceRisk(
                rs.getObject("invoice_id", UUID.class),
                vendorLabel,
                rs.getDouble("risk_score"),
                rs.getString("severity"),
                rs.getDouble("rules_score"),
                mlScore,
                reasons,
                rs.getString("model_version"));
    }

    public record InvoiceRisk(
            UUID invoiceId,
            String vendorLabel,
            double riskScore,
            String severity,
            double rulesScore,
            Double mlScore,
            List<String> reasons,
            String modelVersion
    ) {}
}
