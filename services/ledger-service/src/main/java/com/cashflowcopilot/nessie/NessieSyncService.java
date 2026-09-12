package com.cashflowcopilot.nessie;

import com.cashflowcopilot.cashevent.CashEvent;
import com.cashflowcopilot.cashevent.CashEventService;
import com.cashflowcopilot.config.AppProperties;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieAccountDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieBillDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieDepositDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessiePurchaseDto;
import com.cashflowcopilot.user.AppUser;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NessieSyncService {

    private final NessieClient nessieClient;
    private final NessieNormalizer normalizer;
    private final NessieSyncStateRepository syncStateRepository;
    private final CashEventService cashEventService;
    private final AppProperties properties;
    private final Clock clock;

    public NessieSyncService(
            NessieClient nessieClient,
            NessieNormalizer normalizer,
            NessieSyncStateRepository syncStateRepository,
            CashEventService cashEventService,
            AppProperties properties,
            Clock clock) {
        this.nessieClient = nessieClient;
        this.normalizer = normalizer;
        this.syncStateRepository = syncStateRepository;
        this.cashEventService = cashEventService;
        this.properties = properties;
        this.clock = clock;
    }

    /** Syncs the customer recorded for this user, or the demo customer when none is known. */
    @Transactional
    public SyncResult sync(AppUser user) {
        return sync(user, null);
    }

    /**
     * Syncs a specific Nessie customer for this user. The BFF passes the customer it provisioned
     * for the user's workspace; the id is remembered so later syncs and balance reads use it.
     */
    @Transactional
    public SyncResult sync(AppUser user, String requestedCustomerId) {
        Instant now = Instant.now(clock);
        String customerId = requestedCustomerId == null || requestedCustomerId.isBlank()
                ? customerIdFor(user)
                : requestedCustomerId.trim();
        int inserted = 0;
        int updated = 0;

        for (NessieAccountDto account : nessieClient.getAccounts(customerId)) {
            for (NessiePurchaseDto purchase : nessieClient.getPurchases(account.id())) {
                CashEvent event = normalizer.fromPurchase(user.id(), purchase);
                if (cashEventService.upsertBySourceRecord(event)) {
                    inserted++;
                } else {
                    updated++;
                }
            }
            for (NessieDepositDto deposit : nessieClient.getDeposits(account.id())) {
                CashEvent event = normalizer.fromDeposit(user.id(), deposit);
                if (cashEventService.upsertBySourceRecord(event)) {
                    inserted++;
                } else {
                    updated++;
                }
            }
            for (NessieBillDto bill : nessieClient.getBills(account.id())) {
                CashEvent event = normalizer.fromBill(user.id(), bill, now);
                if (cashEventService.upsertBySourceRecord(event)) {
                    inserted++;
                } else {
                    updated++;
                }
            }
        }

        syncStateRepository.recordSync(user.id(), customerId, now, "ok");
        return new SyncResult(inserted, updated, now);
    }

    /** Available cash comes from the bank, not from replaying ledger history. */
    public BigDecimal currentCash(AppUser user) {
        return accounts(user).stream()
                .map(NessieAccountDto::balance)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    public List<NessieAccountDto> accounts(AppUser user) {
        return nessieClient.getAccounts(customerIdFor(user));
    }

    public Instant lastSyncedAt(AppUser user) {
        return syncStateRepository.findLastSyncedAt(user.id()).orElse(null);
    }

    private String customerIdFor(AppUser user) {
        return syncStateRepository.findCustomerId(user.id())
                .orElse(properties.nessie().demoCustomerId());
    }

    public record SyncResult(int insertedEvents, int updatedEvents, Instant syncedAt) {}
}
