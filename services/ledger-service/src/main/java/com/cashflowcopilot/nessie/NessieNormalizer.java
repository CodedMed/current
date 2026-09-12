package com.cashflowcopilot.nessie;

import com.cashflowcopilot.cashevent.CashEvent;
import com.cashflowcopilot.cashevent.CashEventService;
import com.cashflowcopilot.cashevent.CashEventSource;
import com.cashflowcopilot.cashevent.CashEventStatus;
import com.cashflowcopilot.cashevent.Direction;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieBillDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieDepositDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessiePurchaseDto;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Upstream bank objects to ledger events:
 * purchase -&gt; OUT/ACTUAL, deposit -&gt; IN/ACTUAL, bill -&gt; OUT/EXPECTED (OVERDUE once the date passes).
 */
@Component
public class NessieNormalizer {

    public CashEvent fromPurchase(UUID userId, NessiePurchaseDto purchase) {
        return CashEventService.newEvent(
                userId,
                purchase.purchaseDate(),
                purchase.amount(),
                Direction.OUT,
                categoryOrDefault(purchase.category(), "uncategorised"),
                CashEventSource.NESSIE,
                purchase.id(),
                purchase.description(),
                false,
                CashEventStatus.ACTUAL,
                Map.of("nessieAccountId", purchase.accountId()));
    }

    public CashEvent fromDeposit(UUID userId, NessieDepositDto deposit) {
        return CashEventService.newEvent(
                userId,
                deposit.transactionDate(),
                deposit.amount(),
                Direction.IN,
                "client_payment",
                CashEventSource.NESSIE,
                deposit.id(),
                deposit.description(),
                false,
                CashEventStatus.ACTUAL,
                Map.of("nessieAccountId", deposit.accountId()));
    }

    public CashEvent fromBill(UUID userId, NessieBillDto bill, Instant now) {
        CashEventStatus status = bill.paymentDate().isBefore(now)
                ? CashEventStatus.OVERDUE
                : CashEventStatus.EXPECTED;
        return CashEventService.newEvent(
                userId,
                bill.paymentDate(),
                bill.amount(),
                Direction.OUT,
                categoryOrDefault(bill.category(), "bills"),
                CashEventSource.NESSIE,
                bill.id(),
                bill.nickname() == null ? bill.payee() : bill.nickname(),
                bill.recurring(),
                status,
                Map.of(
                        "nessieAccountId", bill.accountId(),
                        "counterpartyLabel", bill.payee()));
    }

    private String categoryOrDefault(String category, String fallback) {
        return category == null || category.isBlank() ? fallback : category;
    }
}
