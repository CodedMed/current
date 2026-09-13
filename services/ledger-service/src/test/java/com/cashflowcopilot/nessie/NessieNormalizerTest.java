package com.cashflowcopilot.nessie;

import static org.assertj.core.api.Assertions.assertThat;

import com.cashflowcopilot.cashevent.CashEvent;
import com.cashflowcopilot.cashevent.CashEventSource;
import com.cashflowcopilot.cashevent.CashEventStatus;
import com.cashflowcopilot.cashevent.Direction;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieBillDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieDepositDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessiePurchaseDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieWithdrawalDto;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class NessieNormalizerTest {

    private static final Instant NOW = Instant.parse("2026-09-11T00:00:00Z");
    private static final UUID USER_ID = UUID.randomUUID();

    private final NessieNormalizer normalizer = new NessieNormalizer();

    @Test
    void purchaseBecomesSettledOutflow() {
        CashEvent event = normalizer.fromPurchase(USER_ID, purchase("completed", "Office rent", "rent", null));

        assertThat(event.direction()).isEqualTo(Direction.OUT);
        assertThat(event.status()).isEqualTo(CashEventStatus.ACTUAL);
        assertThat(event.source()).isEqualTo(CashEventSource.NESSIE);
        assertThat(event.sourceRecordId()).isEqualTo("pur-1");
        assertThat(event.category()).isEqualTo("rent");
    }

    @Test
    void purchaseCarriesTheMerchantAndMapsItsCategory() {
        CashEvent event = normalizer.fromPurchase(USER_ID, purchase("completed", "Weekly produce", "Food & Beverage", "Sysco"));

        assertThat(event.category()).isEqualTo("food_beverage");
        assertThat(event.description()).isEqualTo("Weekly produce · Sysco");
        assertThat(event.metadata()).containsEntry("counterpartyLabel", "Sysco");
    }

    @Test
    void pendingAndCancelledPurchasesAreNotSettledMoney() {
        assertThat(normalizer.fromPurchase(USER_ID, purchase("pending", "Hold", "software", null)).status())
                .isEqualTo(CashEventStatus.EXPECTED);
        assertThat(normalizer.fromPurchase(USER_ID, purchase("cancelled", "Refunded", "software", null)).status())
                .isEqualTo(CashEventStatus.CANCELLED);
    }

    @Test
    void depositBecomesSettledInflow() {
        CashEvent event = normalizer.fromDeposit(
                USER_ID,
                new NessieDepositDto("dep-1", "acc-1", NOW.minus(1, ChronoUnit.DAYS),
                        new BigDecimal("6000.00"), "completed", "Client payment · Acme"),
                NOW);

        assertThat(event.direction()).isEqualTo(Direction.IN);
        assertThat(event.status()).isEqualTo(CashEventStatus.ACTUAL);
        assertThat(event.category()).isEqualTo("client_payment");
        assertThat(event.metadata()).containsEntry("counterpartyLabel", "Acme");
    }

    @Test
    void pendingDepositIsAnOpenReceivableNamedAfterTheCustomer() {
        CashEvent open = normalizer.fromDeposit(
                USER_ID,
                new NessieDepositDto("dep-2", "acc-1", NOW.plus(10, ChronoUnit.DAYS),
                        new BigDecimal("4000.00"), "pending", "Invoice 1041 · Client A · net 30"),
                NOW);
        assertThat(open.direction()).isEqualTo(Direction.IN);
        assertThat(open.status()).isEqualTo(CashEventStatus.EXPECTED);
        assertThat(open.category()).isEqualTo("client_invoice");
        assertThat(open.metadata()).containsEntry("counterpartyLabel", "Client A");

        CashEvent late = normalizer.fromDeposit(
                USER_ID,
                new NessieDepositDto("dep-3", "acc-1", NOW.minus(12, ChronoUnit.DAYS),
                        new BigDecimal("4000.00"), "pending", "Invoice 1041 · Client A · net 30"),
                NOW);
        assertThat(late.status()).isEqualTo(CashEventStatus.OVERDUE);
    }

    @Test
    void withdrawalBecomesSettledOutflowWithACategory() {
        CashEvent event = normalizer.fromWithdrawal(
                USER_ID,
                new NessieWithdrawalDto("wd-1", "acc-1", NOW.minus(2, ChronoUnit.DAYS),
                        new BigDecimal("5400.00"), "completed", "Payroll · Gusto"),
                NOW);

        assertThat(event.direction()).isEqualTo(Direction.OUT);
        assertThat(event.status()).isEqualTo(CashEventStatus.ACTUAL);
        assertThat(event.category()).isEqualTo("payroll");
        assertThat(event.metadata()).containsEntry("counterpartyLabel", "Gusto");
    }

    @Test
    void internalTransfersAreRecognisedSoTheIngestCanSkipThem() {
        assertThat(normalizer.isInternalTransfer("Transfer · Reserve sweep")).isTrue();
        assertThat(normalizer.isInternalTransfer("Client payment · Acme")).isFalse();
    }

    @Test
    void futureBillBecomesExpectedOutflow() {
        CashEvent event = normalizer.fromBill(USER_ID, bill(NOW.plus(5, ChronoUnit.DAYS), true), NOW);

        assertThat(event.direction()).isEqualTo(Direction.OUT);
        assertThat(event.status()).isEqualTo(CashEventStatus.EXPECTED);
        assertThat(event.recurring()).isTrue();
        assertThat(event.metadata()).containsEntry("counterpartyLabel", "Harbor Property Group");
    }

    @Test
    void oneOffBillWhosePaymentDatePassedIsOverdue() {
        CashEvent event = normalizer.fromBill(USER_ID, bill(NOW.minus(2, ChronoUnit.DAYS), false), NOW);

        assertThat(event.status()).isEqualTo(CashEventStatus.OVERDUE);
    }

    @Test
    void recurringBillWhosePaymentDatePassedRollsToItsNextOccurrence() {
        Instant original = NOW.minus(20, ChronoUnit.DAYS); // 2026-08-22
        CashEvent event = normalizer.fromBill(USER_ID, bill(original, true), NOW);

        assertThat(event.status()).isEqualTo(CashEventStatus.EXPECTED);
        assertThat(event.eventTime()).isAfter(NOW);
        assertThat(event.eventTime().atZone(ZoneOffset.UTC).getDayOfMonth()).isEqualTo(22);
        assertThat(event.sourceRecordId()).isEqualTo("bill-1");
    }

    @Test
    void paidOrCancelledBillsLeaveTheForecast() {
        NessieBillDto paid = new NessieBillDto("bill-9", "acc-1", "Metro Utilities", "Utilities",
                NOW.plus(3, ChronoUnit.DAYS), new BigDecimal("800.00"), "completed", false, null);
        assertThat(normalizer.fromBill(USER_ID, paid, NOW).status()).isEqualTo(CashEventStatus.CANCELLED);
    }

    private static NessiePurchaseDto purchase(String status, String description, String category, String merchant) {
        return new NessiePurchaseDto("pur-1", "acc-1", NOW.minus(3, ChronoUnit.DAYS),
                new BigDecimal("2200.00"), status, description, category, merchant);
    }

    private static NessieBillDto bill(Instant paymentDate, boolean recurring) {
        return new NessieBillDto(
                "bill-1",
                "acc-1",
                "Harbor Property Group",
                "Office rent",
                paymentDate,
                new BigDecimal("2200.00"),
                recurring ? "recurring" : "pending",
                recurring,
                "rent");
    }
}
