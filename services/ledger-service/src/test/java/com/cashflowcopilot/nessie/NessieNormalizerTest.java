package com.cashflowcopilot.nessie;

import static org.assertj.core.api.Assertions.assertThat;

import com.cashflowcopilot.cashevent.CashEvent;
import com.cashflowcopilot.cashevent.CashEventSource;
import com.cashflowcopilot.cashevent.CashEventStatus;
import com.cashflowcopilot.cashevent.Direction;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieBillDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieDepositDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessiePurchaseDto;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class NessieNormalizerTest {

    private static final Instant NOW = Instant.parse("2026-09-11T00:00:00Z");
    private static final UUID USER_ID = UUID.randomUUID();

    private final NessieNormalizer normalizer = new NessieNormalizer();

    @Test
    void purchaseBecomesSettledOutflow() {
        CashEvent event = normalizer.fromPurchase(
                USER_ID,
                new NessiePurchaseDto(
                        "pur-1",
                        "acc-1",
                        NOW.minus(3, ChronoUnit.DAYS),
                        new BigDecimal("2200.00"),
                        "completed",
                        "Office rent",
                        "rent"));

        assertThat(event.direction()).isEqualTo(Direction.OUT);
        assertThat(event.status()).isEqualTo(CashEventStatus.ACTUAL);
        assertThat(event.source()).isEqualTo(CashEventSource.NESSIE);
        assertThat(event.sourceRecordId()).isEqualTo("pur-1");
        assertThat(event.category()).isEqualTo("rent");
    }

    @Test
    void depositBecomesSettledInflow() {
        CashEvent event = normalizer.fromDeposit(
                USER_ID,
                new NessieDepositDto(
                        "dep-1",
                        "acc-1",
                        NOW.minus(1, ChronoUnit.DAYS),
                        new BigDecimal("6000.00"),
                        "completed",
                        "Client payment"));

        assertThat(event.direction()).isEqualTo(Direction.IN);
        assertThat(event.status()).isEqualTo(CashEventStatus.ACTUAL);
    }

    @Test
    void futureBillBecomesExpectedOutflow() {
        CashEvent event = normalizer.fromBill(USER_ID, bill(NOW.plus(5, ChronoUnit.DAYS)), NOW);

        assertThat(event.direction()).isEqualTo(Direction.OUT);
        assertThat(event.status()).isEqualTo(CashEventStatus.EXPECTED);
        assertThat(event.recurring()).isTrue();
        assertThat(event.metadata()).containsEntry("counterpartyLabel", "Harbor Property Group");
    }

    @Test
    void billWhosePaymentDatePassedIsOverdue() {
        CashEvent event = normalizer.fromBill(USER_ID, bill(NOW.minus(2, ChronoUnit.DAYS)), NOW);

        assertThat(event.status()).isEqualTo(CashEventStatus.OVERDUE);
    }

    private static NessieBillDto bill(Instant paymentDate) {
        return new NessieBillDto(
                "bill-1",
                "acc-1",
                "Harbor Property Group",
                "Office rent",
                paymentDate,
                new BigDecimal("2200.00"),
                "pending",
                true,
                "rent");
    }
}
