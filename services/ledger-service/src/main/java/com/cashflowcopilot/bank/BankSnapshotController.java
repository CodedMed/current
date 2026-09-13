package com.cashflowcopilot.bank;

import com.cashflowcopilot.auth.CurrentUser;
import com.cashflowcopilot.nessie.NessieSyncService.SyncResult;
import com.cashflowcopilot.user.AppUser;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The BFF pushes the bank snapshot it already fetched for the user's workspace. The ledger stays
 * the authority on normalisation and idempotency; the BFF only delivers the records.
 */
@RestController
@RequestMapping("/v1/bank")
public class BankSnapshotController {

    private final BankIngestService ingestService;

    public BankSnapshotController(BankIngestService ingestService) {
        this.ingestService = ingestService;
    }

    @PostMapping("/snapshot")
    public SyncResult ingest(@CurrentUser AppUser user, @Valid @RequestBody BankSnapshotRequest request) {
        return ingestService.ingest(user, request.customerId().trim(), request.toFeed());
    }
}
