package com.cashflowcopilot.bank;

import com.cashflowcopilot.bank.BankAccountRepository.BankAccount;
import com.cashflowcopilot.cashevent.CashEvent;
import com.cashflowcopilot.cashevent.CashEventService;
import com.cashflowcopilot.nessie.NessieNormalizer;
import com.cashflowcopilot.nessie.NessieSyncService.SyncResult;
import com.cashflowcopilot.nessie.NessieSyncStateRepository;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieAccountDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieBillDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieDepositDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessiePurchaseDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieWithdrawalDto;
import com.cashflowcopilot.user.AppUser;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Turns a {@link BankFeed} into ledger state: cash events (idempotent on the bank's record ids),
 * account balances, and the sync record. Shared by the pull path ({@code POST /v1/nessie/sync})
 * and the push path ({@code POST /v1/bank/snapshot}) so they cannot drift apart.
 *
 * <p>When the feed belongs to a different bank customer than the one previously ingested, every
 * event that came from the old feed (or was seeded alongside it) is dropped first. Document-derived
 * events and manual entries without a source record are kept.
 */
@Service
public class BankIngestService {

    private static final Logger log = LoggerFactory.getLogger(BankIngestService.class);

    private final NessieNormalizer normalizer;
    private final CashEventService cashEventService;
    private final BankAccountRepository bankAccounts;
    private final NessieSyncStateRepository syncState;
    private final Clock clock;

    public BankIngestService(
            NessieNormalizer normalizer,
            CashEventService cashEventService,
            BankAccountRepository bankAccounts,
            NessieSyncStateRepository syncState,
            Clock clock) {
        this.normalizer = normalizer;
        this.cashEventService = cashEventService;
        this.bankAccounts = bankAccounts;
        this.syncState = syncState;
        this.clock = clock;
    }

    @Transactional
    public SyncResult ingest(AppUser user, String customerId, BankFeed feed) {
        Instant now = Instant.now(clock);

        Optional<String> previous = syncState.findCustomerId(user.id());
        if (previous.isPresent() && !previous.get().equals(customerId)) {
            int purged = cashEventService.deleteIngested(user.id());
            log.info("Bank customer for user {} changed from {} to {}: dropped {} ingested events",
                    user.id(), previous.get(), customerId, purged);
        }

        int inserted = 0;
        int updated = 0;
        for (NessiePurchaseDto purchase : feed.purchases()) {
            if (upsert(normalizer.fromPurchase(user.id(), purchase))) inserted++; else updated++;
        }
        for (NessieDepositDto deposit : feed.deposits()) {
            if (normalizer.isInternalTransfer(deposit.description())) continue;
            if (upsert(normalizer.fromDeposit(user.id(), deposit, now))) inserted++; else updated++;
        }
        for (NessieWithdrawalDto withdrawal : feed.withdrawals()) {
            if (normalizer.isInternalTransfer(withdrawal.description())) continue;
            if (upsert(normalizer.fromWithdrawal(user.id(), withdrawal, now))) inserted++; else updated++;
        }
        for (NessieBillDto bill : feed.bills()) {
            if (upsert(normalizer.fromBill(user.id(), bill, now))) inserted++; else updated++;
        }

        List<BankAccount> accounts = feed.accounts().stream()
                .map(account -> new BankAccount(
                        account.id(), account.type(), account.nickname(), signedBalance(account), now))
                .toList();
        bankAccounts.replaceAll(user.id(), accounts, now);
        syncState.recordSync(user.id(), customerId, now, "ok");
        return new SyncResult(inserted, updated, now);
    }

    private boolean upsert(CashEvent event) {
        return cashEventService.upsertBySourceRecord(event);
    }

    /** The bank reports a card's balance as the amount owed; as cash it counts against the business. */
    static BigDecimal signedBalance(NessieAccountDto account) {
        BigDecimal balance = account.balance() == null ? BigDecimal.ZERO : account.balance();
        String type = account.type() == null ? "" : account.type().toLowerCase(Locale.ROOT);
        return type.contains("credit") ? balance.negate() : balance;
    }
}
