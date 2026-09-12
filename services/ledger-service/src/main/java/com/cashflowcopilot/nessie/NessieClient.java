package com.cashflowcopilot.nessie;

import com.cashflowcopilot.nessie.dto.NessieDtos.NessieAccountDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieBillDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessieDepositDto;
import com.cashflowcopilot.nessie.dto.NessieDtos.NessiePurchaseDto;
import java.util.List;

/** Bank data port. Swapped for {@code MockNessieClient} whenever no API key is configured. */
public interface NessieClient {

    List<NessieAccountDto> getAccounts(String customerId);

    List<NessiePurchaseDto> getPurchases(String accountId);

    List<NessieDepositDto> getDeposits(String accountId);

    List<NessieBillDto> getBills(String accountId);
}
