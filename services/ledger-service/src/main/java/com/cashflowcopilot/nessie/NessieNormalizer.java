package com.cashflowcopilot.nessie;

import com.cashflowcopilot.cashevent.CashEvent;
import com.cashflowcopilot.cashevent.CashEventService;
import com.cashflowcopilot.cashevent.CashEventSource;
import com.cashflowcopilot.cashevent.CashEventStatus;
import com.cashflowcopilot.cashevent.Direction;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieBillDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieDepositDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessiePurchaseDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieWithdrawalDto;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Upstream bank objects to ledger events:
 * <ul>
 *   <li>purchase / withdrawal: settled &rarr; OUT/ACTUAL, pending &rarr; OUT/EXPECTED, cancelled &rarr; CANCELLED</li>
 *   <li>deposit: settled &rarr; IN/ACTUAL; pending &rarr; an open receivable, IN/EXPECTED (OVERDUE once its date passes)</li>
 *   <li>bill: OUT/EXPECTED; a one-off whose date passed is OVERDUE, a recurring one rolls to its next occurrence</li>
 * </ul>
 * Internal transfers between the business's own accounts are not cash flow and are skipped by the
 * ingest, see {@link #isInternalTransfer(String)}.
 */
@Component
public class NessieNormalizer {

    /** Description prefix the BFF stamps on a deposit/withdrawal pair that moves money between own accounts. */
    public static final String INTERNAL_TRANSFER_PREFIX = "Transfer · ";

    public boolean isInternalTransfer(String description) {
        return description != null && description.startsWith(INTERNAL_TRANSFER_PREFIX);
    }

    public CashEvent fromPurchase(UUID userId, NessiePurchaseDto purchase) {
        Map<String, Object> metadata = new HashMap<>();
        metadata.put("nessieAccountId", purchase.accountId());
        if (present(purchase.merchantName())) {
            metadata.put("counterpartyLabel", purchase.merchantName());
        }
        String description = present(purchase.description())
                ? (present(purchase.merchantName()) && !purchase.description().contains(purchase.merchantName())
                        ? purchase.description() + " · " + purchase.merchantName()
                        : purchase.description())
                : purchase.merchantName();
        return CashEventService.newEvent(
                userId,
                purchase.purchaseDate(),
                purchase.amount(),
                Direction.OUT,
                present(purchase.category()) ? CategoryMapper.merchant(purchase.category()) : "other_expenses",
                CashEventSource.NESSIE,
                purchase.id(),
                description,
                false,
                settlementStatus(purchase.status()),
                metadata);
    }

    public CashEvent fromDeposit(UUID userId, NessieDepositDto deposit, Instant now) {
        boolean pending = "pending".equalsIgnoreCase(deposit.status());
        CashEventStatus status = pending
                ? (deposit.transactionDate().isBefore(now) ? CashEventStatus.OVERDUE : CashEventStatus.EXPECTED)
                : settlementStatus(deposit.status());
        String counterparty = pending
                ? CategoryMapper.receivableCounterparty(deposit.description())
                : CategoryMapper.counterparty(deposit.description());
        Map<String, Object> metadata = new HashMap<>();
        metadata.put("nessieAccountId", deposit.accountId());
        if (present(counterparty)) {
            metadata.put("counterpartyLabel", counterparty);
        }
        return CashEventService.newEvent(
                userId,
                deposit.transactionDate(),
                deposit.amount(),
                Direction.IN,
                pending ? "client_invoice" : CategoryMapper.income(deposit.description()),
                CashEventSource.NESSIE,
                deposit.id(),
                deposit.description(),
                false,
                status,
                metadata);
    }

    public CashEvent fromWithdrawal(UUID userId, NessieWithdrawalDto withdrawal, Instant now) {
        Map<String, Object> metadata = new HashMap<>();
        metadata.put("nessieAccountId", withdrawal.accountId());
        String counterparty = CategoryMapper.counterparty(withdrawal.description());
        if (present(counterparty)) {
            metadata.put("counterpartyLabel", counterparty);
        }
        return CashEventService.newEvent(
                userId,
                withdrawal.transactionDate(),
                withdrawal.amount(),
                Direction.OUT,
                CategoryMapper.withdrawal(withdrawal.description()),
                CashEventSource.NESSIE,
                withdrawal.id(),
                withdrawal.description(),
                false,
                settlementStatus(withdrawal.status()),
                metadata);
    }

    public CashEvent fromBill(UUID userId, NessieBillDto bill, Instant now) {
        String billStatus = bill.status() == null ? "" : bill.status().toLowerCase(Locale.ROOT);
        Instant due = bill.paymentDate();
        CashEventStatus status;
        if (billStatus.equals("cancelled") || billStatus.equals("completed")) {
            // Paid bills already appear as withdrawals; the obligation itself is gone.
            status = CashEventStatus.CANCELLED;
        } else if (!due.isBefore(now)) {
            status = CashEventStatus.EXPECTED;
        } else if (bill.recurring()) {
            // The bank keeps a recurring bill's original date; the next occurrence is what is owed.
            due = nextOccurrence(due, now);
            status = CashEventStatus.EXPECTED;
        } else {
            status = CashEventStatus.OVERDUE;
        }
        String category = present(bill.category())
                ? CategoryMapper.merchant(bill.category())
                : CategoryMapper.bill((bill.nickname() == null ? "" : bill.nickname()) + " " + (bill.payee() == null ? "" : bill.payee()));
        return CashEventService.newEvent(
                userId,
                due,
                bill.amount(),
                Direction.OUT,
                category,
                CashEventSource.NESSIE,
                bill.id(),
                bill.nickname() == null ? bill.payee() : bill.nickname(),
                bill.recurring(),
                status,
                Map.of(
                        "nessieAccountId", bill.accountId(),
                        "counterpartyLabel", bill.payee() == null ? "" : bill.payee()));
    }

    /** The same day of month, in the first month where it is still ahead of {@code now}. */
    static Instant nextOccurrence(Instant due, Instant now) {
        LocalDate today = now.atZone(ZoneOffset.UTC).toLocalDate();
        int day = due.atZone(ZoneOffset.UTC).toLocalDate().getDayOfMonth();
        YearMonth month = YearMonth.from(today);
        LocalDate candidate = month.atDay(Math.min(day, month.lengthOfMonth()));
        while (!candidate.isAfter(today)) {
            month = month.plusMonths(1);
            candidate = month.atDay(Math.min(day, month.lengthOfMonth()));
        }
        return candidate.atTime(LocalTime.NOON).toInstant(ZoneOffset.UTC);
    }

    private static CashEventStatus settlementStatus(String status) {
        String s = status == null ? "" : status.toLowerCase(Locale.ROOT);
        return switch (s) {
            case "cancelled", "canceled" -> CashEventStatus.CANCELLED;
            case "pending" -> CashEventStatus.EXPECTED;
            default -> CashEventStatus.ACTUAL;
        };
    }

    private static boolean present(String value) {
        return value != null && !value.isBlank();
    }
}
