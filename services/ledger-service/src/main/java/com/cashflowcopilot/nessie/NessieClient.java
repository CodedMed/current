package com.cashflowcopilot.nessie;

import com.cashflowcopilot.nessie.dto.NessieDtos.NessieAccountDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieBillDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieDepositDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessiePurchaseDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieWithdrawalDto;
import java.util.List;

/**
 * Bank data port for the pull path. Swapped for {@code MockNessieClient} whenever no API key is
 * configured. The BFF normally pushes the same data through {@code POST /v1/bank/snapshot}
 * instead, so this client is only exercised for standalone deployments and the demo customer.
 */
public interface NessieClient {

    List<NessieAccountDto> getAccounts(String customerId);

    List<NessiePurchaseDto> getPurchases(String accountId);

    List<NessieDepositDto> getDeposits(String accountId);

    /** Payroll, taxes and bill payments arrive as withdrawals; a feed without them has no burn rate. */
    default List<NessieWithdrawalDto> getWithdrawals(String accountId) {
        return List.of();
    }

    List<NessieBillDto> getBills(String accountId);
}
