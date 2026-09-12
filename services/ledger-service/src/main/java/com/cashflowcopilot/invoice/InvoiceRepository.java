package com.cashflowcopilot.invoice;

import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class InvoiceRepository {

    private static final String COLUMNS = """
            id, user_id, vendor_key, vendor_display_name, invoice_number_hash, amount, previous_amount,
            invoice_date, due_date, paid_date, status, recurring, payment_destination_fingerprint,
            source, extraction_confidence, created_at
            """;

    private final JdbcClient jdbcClient;

    public InvoiceRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public List<Invoice> findByUser(UUID userId) {
        return jdbcClient.sql("SELECT " + COLUMNS + """
                          FROM invoices
                         WHERE user_id = ?
                         ORDER BY COALESCE(due_date, invoice_date) DESC NULLS LAST, created_at DESC
                        """)
                .param(userId)
                .query(InvoiceRepository::mapRow)
                .list();
    }

    public Optional<Invoice> findById(UUID userId, UUID invoiceId) {
        return jdbcClient.sql("SELECT " + COLUMNS + " FROM invoices WHERE user_id = ? AND id = ?")
                .params(userId, invoiceId)
                .query(InvoiceRepository::mapRow)
                .optional();
    }

    /** Vendor history powers the Phase 4 anomaly features. */
    public List<Invoice> findVendorHistory(UUID userId, String vendorKey) {
        return jdbcClient.sql("SELECT " + COLUMNS + """
                          FROM invoices
                         WHERE user_id = ? AND vendor_key = ?
                         ORDER BY invoice_date DESC NULLS LAST
                        """)
                .params(userId, vendorKey)
                .query(InvoiceRepository::mapRow)
                .list();
    }

    public int countForUser(UUID userId) {
        return jdbcClient.sql("SELECT COUNT(*) FROM invoices WHERE user_id = ?")
                .param(userId)
                .query(Integer.class)
                .single();
    }

    public void insert(Invoice invoice) {
        jdbcClient.sql("""
                        INSERT INTO invoices (
                            id, user_id, vendor_key, vendor_display_name, invoice_number_hash, amount,
                            previous_amount, invoice_date, due_date, paid_date, status, recurring,
                            payment_destination_fingerprint, source, extraction_confidence)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """)
                .params(
                        invoice.id(),
                        invoice.userId(),
                        invoice.vendorKey(),
                        invoice.vendorDisplayName(),
                        invoice.invoiceNumberHash(),
                        invoice.amount(),
                        invoice.previousAmount(),
                        toSqlDate(invoice.invoiceDate()),
                        toSqlDate(invoice.dueDate()),
                        toSqlDate(invoice.paidDate()),
                        invoice.status(),
                        invoice.recurring(),
                        invoice.paymentDestinationFingerprint(),
                        invoice.source(),
                        invoice.extractionConfidence())
                .update();
    }

    private static Date toSqlDate(LocalDate date) {
        return date == null ? null : Date.valueOf(date);
    }

    private static Invoice mapRow(ResultSet rs, int rowNum) throws SQLException {
        Date invoiceDate = rs.getDate("invoice_date");
        Date dueDate = rs.getDate("due_date");
        Date paidDate = rs.getDate("paid_date");
        Double confidence = rs.getObject("extraction_confidence") == null
                ? null
                : rs.getDouble("extraction_confidence");
        return new Invoice(
                rs.getObject("id", UUID.class),
                rs.getObject("user_id", UUID.class),
                rs.getString("vendor_key"),
                rs.getString("vendor_display_name"),
                rs.getString("invoice_number_hash"),
                rs.getBigDecimal("amount"),
                rs.getBigDecimal("previous_amount"),
                invoiceDate == null ? null : invoiceDate.toLocalDate(),
                dueDate == null ? null : dueDate.toLocalDate(),
                paidDate == null ? null : paidDate.toLocalDate(),
                rs.getString("status"),
                rs.getBoolean("recurring"),
                rs.getString("payment_destination_fingerprint"),
                rs.getString("source"),
                confidence,
                rs.getTimestamp("created_at").toInstant());
    }
}
