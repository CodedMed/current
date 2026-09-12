package com.cashflowcopilot.nessie;

import com.cashflowcopilot.auth.CurrentUser;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieAccountDto;
import com.cashflowcopilot.user.AppUser;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class NessieController {

    private final NessieSyncService syncService;

    public NessieController(NessieSyncService syncService) {
        this.syncService = syncService;
    }

    /**
     * Idempotent ingest. The body is optional: the BFF sends the Nessie customer it provisioned
     * for the user's workspace, otherwise the previously recorded (or demo) customer is used.
     */
    @PostMapping("/v1/nessie/sync")
    public NessieSyncService.SyncResult sync(
            @CurrentUser AppUser user,
            @RequestBody(required = false) SyncRequest request) {
        return syncService.sync(user, request == null ? null : request.customerId());
    }

    @GetMapping("/v1/accounts/summary")
    public AccountsSummary summary(@CurrentUser AppUser user) {
        List<NessieAccountDto> accounts = syncService.accounts(user);
        List<AccountSummary> summaries = accounts.stream()
                .map(account -> new AccountSummary(account.id(), account.nickname(), account.type(), account.balance()))
                .toList();
        return new AccountsSummary(
                syncService.currentCash(user),
                summaries,
                syncService.lastSyncedAt(user));
    }

    public record SyncRequest(@Size(max = 200) String customerId) {}

    public record AccountsSummary(BigDecimal totalBalance, List<AccountSummary> accounts, Instant lastSyncedAt) {}

    public record AccountSummary(String id, String nickname, String type, BigDecimal balance) {}
}
