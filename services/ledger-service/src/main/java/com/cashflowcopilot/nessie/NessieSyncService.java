package com.cashflowcopilot.nessie;

import com.cashflowcopilot.bank.BankAccountRepository;
import com.cashflowcopilot.bank.BankAccountRepository.BankAccount;
import com.cashflowcopilot.bank.BankFeed;
import com.cashflowcopilot.bank.BankIngestService;
import com.cashflowcopilot.config.AppProperties;
import com.cashflowcopilot.error.ApiException;
import com.cashflowcopilot.error.ErrorCode;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieAccountDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieBillDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieDepositDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessiePurchaseDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieWithdrawalDto;
import com.cashflowcopilot.user.AppUser;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Pull path: reads a customer from the configured Nessie client and hands the feed to
 * {@link BankIngestService}. Balances are answered from the last ingested feed, never from a live
 * call, so a bank outage or an unknown customer cannot turn the dashboard into $0 mid-demo.
 *
 * <p>The demo customer is always served by the fixture client, even when a live key is configured:
 * the demo business does not exist at the real API, and the seeded scenario depends on its $8,000.
 */
@Service
public class NessieSyncService {

    private final NessieClient nessieClient;
    private final MockNessieClient demoNessieClient;
    private final BankIngestService ingestService;
    private final NessieSyncStateRepository syncStateRepository;
    private final BankAccountRepository bankAccounts;
    private final AppProperties properties;

    public NessieSyncService(
            NessieClient nessieClient,
            @Qualifier("demoNessieClient") MockNessieClient demoNessieClient,
            BankIngestService ingestService,
            NessieSyncStateRepository syncStateRepository,
            BankAccountRepository bankAccounts,
            AppProperties properties) {
        this.nessieClient = nessieClient;
        this.demoNessieClient = demoNessieClient;
        this.ingestService = ingestService;
        this.syncStateRepository = syncStateRepository;
        this.bankAccounts = bankAccounts;
        this.properties = properties;
    }

    /** Syncs the customer recorded for this user, or the demo customer when none is known. */
    @Transactional
    public SyncResult sync(AppUser user) {
        return sync(user, null);
    }

    /**
     * Syncs a specific Nessie customer for this user. The BFF passes the customer it provisioned
     * for the user's workspace; the id is remembered so later syncs use it.
     */
    @Transactional
    public SyncResult sync(AppUser user, String requestedCustomerId) {
        String customerId = requestedCustomerId == null || requestedCustomerId.isBlank()
                ? customerIdFor(user)
                : requestedCustomerId.trim();
        NessieClient client = clientFor(customerId);
        return ingestService.ingest(user, customerId, pull(client, customerId));
    }

    private NessieClient clientFor(String customerId) {
        if (!customerId.equals(properties.nessie().demoCustomerId())) {
            return nessieClient;
        }
        if (!properties.demoMode()) {
            throw new ApiException(ErrorCode.NESSIE_SYNC_FAILED,
                    "No bank customer is linked to this user. Push a bank snapshot or pass a customerId.");
        }
        return demoNessieClient;
    }

    private static BankFeed pull(NessieClient client, String customerId) {
        List<NessieAccountDto> accounts = client.getAccounts(customerId);
        List<NessiePurchaseDto> purchases = new ArrayList<>();
        List<NessieDepositDto> deposits = new ArrayList<>();
        List<NessieWithdrawalDto> withdrawals = new ArrayList<>();
        List<NessieBillDto> bills = new ArrayList<>();
        for (NessieAccountDto account : accounts) {
            purchases.addAll(client.getPurchases(account.id()));
            deposits.addAll(client.getDeposits(account.id()));
            withdrawals.addAll(client.getWithdrawals(account.id()));
            bills.addAll(client.getBills(account.id()));
        }
        return new BankFeed(accounts, purchases, deposits, withdrawals, bills);
    }

    /**
     * Balances for a user whose events predate the {@code bank_accounts} table (an upgraded
     * database): re-reads the demo feed once, which is idempotent for the events and fills the
     * balances in. Only applies to the demo customer; a workspace user is refreshed by the BFF's
     * next push.
     */
    @Transactional
    public boolean backfillDemoBalancesIfMissing(AppUser user) {
        if (!properties.demoMode() || bankAccounts.countForUser(user.id()) > 0) {
            return false;
        }
        String demoCustomerId = properties.nessie().demoCustomerId();
        String recorded = syncStateRepository.findCustomerId(user.id()).orElse(demoCustomerId);
        if (!recorded.equals(demoCustomerId)) {
            return false;
        }
        sync(user, demoCustomerId);
        return true;
    }

    /** Available cash: the signed sum of the last ingested balances (zero until something was ingested). */
    public BigDecimal currentCash(AppUser user) {
        return bankAccounts.sumBalance(user.id());
    }

    public List<NessieAccountDto> accounts(AppUser user) {
        return bankAccounts.findByUser(user.id()).stream()
                .map(account -> new NessieAccountDto(
                        account.accountId(), account.type(), account.nickname(), account.balance()))
                .toList();
    }

    public List<BankAccount> bankAccounts(AppUser user) {
        return bankAccounts.findByUser(user.id());
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
