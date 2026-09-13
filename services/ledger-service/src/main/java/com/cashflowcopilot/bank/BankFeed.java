package com.cashflowcopilot.bank;

import com.cashflowcopilot.nessie.dto.NessieDtos.NessieAccountDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieBillDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieDepositDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessiePurchaseDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieWithdrawalDto;
import java.util.List;

/**
 * One customer's bank data, whichever way it arrived: pulled by the ledger's own Nessie client or
 * pushed by the BFF from the workspace it already holds. Both paths normalise it identically.
 */
public record BankFeed(
        List<NessieAccountDto> accounts,
        List<NessiePurchaseDto> purchases,
        List<NessieDepositDto> deposits,
        List<NessieWithdrawalDto> withdrawals,
        List<NessieBillDto> bills
) {

    public static BankFeed empty() {
        return new BankFeed(List.of(), List.of(), List.of(), List.of(), List.of());
    }
}
