package com.cashflowcopilot.bank;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * Account balances as last ingested. Signed: deposit accounts positive, credit cards negative, so
 * {@link #sumBalance(UUID)} is the cash position. All queries are user-scoped and parameterized.
 */
@Repository
public class BankAccountRepository {

    private final JdbcClient jdbcClient;

    public BankAccountRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public List<BankAccount> findByUser(UUID userId) {
        return jdbcClient.sql("""
                        SELECT account_id, account_type, nickname, balance, synced_at
                          FROM bank_accounts
                         WHERE user_id = ?
                         ORDER BY account_type, nickname
                        """)
                .param(userId)
                .query(BankAccountRepository::mapRow)
                .list();
    }

    public BigDecimal sumBalance(UUID userId) {
        return jdbcClient.sql("SELECT COALESCE(SUM(balance), 0) FROM bank_accounts WHERE user_id = ?")
                .param(userId)
                .query(BigDecimal.class)
                .single();
    }

    public int countForUser(UUID userId) {
        return jdbcClient.sql("SELECT COUNT(*) FROM bank_accounts WHERE user_id = ?")
                .param(userId)
                .query(Integer.class)
                .single();
    }

    /** The feed is the truth: whatever the bank no longer lists is gone. */
    public void replaceAll(UUID userId, List<BankAccount> accounts, Instant syncedAt) {
        jdbcClient.sql("DELETE FROM bank_accounts WHERE user_id = ?").param(userId).update();
        for (BankAccount account : accounts) {
            jdbcClient.sql("""
                            INSERT INTO bank_accounts (user_id, account_id, account_type, nickname, balance, synced_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                            """)
                    .params(userId, account.accountId(), account.type(), account.nickname(),
                            account.balance(), Timestamp.from(syncedAt))
                    .update();
        }
    }

    private static BankAccount mapRow(ResultSet rs, int rowNum) throws SQLException {
        return new BankAccount(
                rs.getString("account_id"),
                rs.getString("account_type"),
                rs.getString("nickname"),
                rs.getBigDecimal("balance"),
                rs.getTimestamp("synced_at").toInstant());
    }

    public record BankAccount(String accountId, String type, String nickname, BigDecimal balance, Instant syncedAt) {}
}
