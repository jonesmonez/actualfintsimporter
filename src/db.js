import Database from 'better-sqlite3';

export class DatabaseHandler {
    constructor(path = 'data/bank.db') {
        this.db = new Database(path);

        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');

        this.initialize();
    }

    initialize() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS bank_connections (
                id INTEGER PRIMARY KEY,
                user_id TEXT NOT NULL,
                bank_id TEXT NOT NULL,
                bank_name TEXT,
                bank_abr TEXT NOT NULL,
                banking_information TEXT,
                updated_at TEXT NOT NULL,
                account_group_id INTEGER,

                UNIQUE (user_id, bank_id)
            );

            
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY,

                connection_id INTEGER NOT NULL,
                account_number TEXT NOT NULL,

                iban TEXT NOT NULL,
                name TEXT NOT NULL,
                actual_id TEXT,
                currency TEXT NOT NULL,
                balance INTEGER NOT NULL,

                bank_country INTEGER,
                bank_id TEXT,
                bic TEXT,

                customer_id TEXT,
                account_type TEXT,
                holder1 TEXT,
                product TEXT,
                allowed_transactions TEXT,
                is_sepa_account INTEGER,

                last_fetched_at TEXT,
                opening_balance_pending INTEGER NOT NULL DEFAULT 0,

                FOREIGN KEY(connection_id)
                    REFERENCES bank_connections(id),

                UNIQUE(connection_id, account_number),
                UNIQUE(actual_id)
            );


            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY,

                account_id INTEGER NOT NULL,
                transaction_id TEXT NOT NULL,

                entry_date TEXT,
                value_date TEXT,
                amount INTEGER NOT NULL,

                counterparty TEXT,
                counterparty_name TEXT,
                purpose TEXT,

                funds_code TEXT,
                transaction_type TEXT,
                customer_reference TEXT,
                bank_reference TEXT,
                transaction_code TEXT,
                remote_name TEXT,
                remote_account_number TEXT,
                remote_bank_id TEXT,
                e2e_reference TEXT,
                mandate_reference TEXT,
                additional_information TEXT,
                booking_text TEXT,

                pending INTEGER NOT NULL DEFAULT 0,
                imported INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

                FOREIGN KEY(account_id)
                    REFERENCES accounts(id),
                UNIQUE(account_id, transaction_id)
            );

            CREATE TABLE IF NOT EXISTS simplefin_claim_tokens (
                token_hash TEXT PRIMARY KEY,
                expires_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS simplefin_access_credentials (
                credential_hash TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS actual_budget (
                id INTEGER PRIMARY KEY,
                sync_id TEXT NOT NULL,
                name TEXT NOT NULL,

                UNIQUE(sync_id),
                UNIQUE(name)
            );
        `)
    }

    createBankConnection(bankConfig) {
        const result = this.db.prepare(`
            INSERT INTO bank_connections (
                user_id, bank_id, bank_abr, updated_at
            )
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, bank_id) DO UPDATE SET
                bank_abr = excluded.bank_abr,
                updated_at = excluded.updated_at;
        `).run(
            bankConfig.user,
            bankConfig.blz,
            bankConfig.bank,
            new Date().toISOString(),
        );
    }

    updateBankingInformation(bankConfig, bankingInformation) {
        const result = this.db.prepare(`
            UPDATE bank_connections
            SET banking_information = ?, updated_at = ?
            WHERE user_id = ? AND bank_id = ?;
        `).run(
            bankingInformation ? JSON.stringify(bankingInformation) : null,
            new Date().toISOString(),
            bankConfig.user,
            bankConfig.blz
        );
    }

    updateBankNameForBankConnection(bankConfig, bankName) {
        const result = this.db.prepare(`
            UPDATE bank_connections
            SET bank_name = ?
            WHERE user_id = ? AND bank_id = ?;
        `).run(bankName, bankConfig.user, bankConfig.blz);
    }

    updateGroupIdForBankConnection(bankConfig, accountGroupId) {
        const result = this.db.prepare(`
            UPDATE bank_connections
            SET account_group_id = ?
            WHERE user_id = ? AND bank_id = ?;
        `).run(accountGroupId, bankConfig.user, bankConfig.blz);
    }

    getBankConnections() {
        const connections = this.db.prepare(`
            SELECT 
                id,
                user_id AS user,
                bank_id AS blz,
                bank_name,
                bank_abr,
                banking_information,
                updated_at,
                account_group_id
            FROM bank_connections;
        `).all()

        if (!connections) {
            return null;
        }

        for (const connection of connections) {
            if (connection.banking_information) {
                connection.banking_information = JSON.parse(connection.banking_information);
            }
        }

        return connections;
    }

    getBankConnection(bankConfig) {
        const connection = this.db.prepare(`
            SELECT
                id,
                user_id AS user,
                bank_id AS blz,
                bank_name,
                bank_abr,
                banking_information,
                updated_at,
                account_group_id
            FROM bank_connections WHERE user_id = ? AND bank_id = ?;    
        `).get(bankConfig.user, bankConfig.blz);

        if (!connection) {
            return null;
        }

        if (connection.banking_information) {
            connection.banking_information = JSON.parse(connection.banking_information);
        }

        return connection;
    }

    getBankingInformation(bankConfig) {
        const connection = this.getBankConnection(bankConfig);
        if (connection) {
            return connection.banking_information;
        } else {
            return null;
        }
    }

    getBankConnectionId(bankConfig) {
        const connection = this.getBankConnection(bankConfig);
        if (!connection) {
            throw new Error(`Unknown bank connection for ${bankConfig.blz}`);
        }
        return connection.id;
    }

    saveAccount(account) {
        return this.db.prepare(`
            INSERT INTO accounts (
                connection_id,
                account_number,
                iban,
                name,
                actual_id,
                currency,
                balance,
                bank_country,
                bank_id,
                customer_id,
                account_type,
                holder1,
                product,
                allowed_transactions,
                is_sepa_account,
                bic
            )
            VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?
            )

            ON CONFLICT(connection_id, account_number)
            DO UPDATE SET
                iban = excluded.iban,
                name = excluded.name,
                currency = excluded.currency,
                balance = excluded.balance,
                bank_country = excluded.bank_country,
                bank_id = excluded.bank_id,
                customer_id = excluded.customer_id,
                account_type = excluded.account_type,
                holder1 = excluded.holder1,
                product = excluded.product,
                allowed_transactions = excluded.allowed_transactions,
                is_sepa_account = excluded.is_sepa_account,
                bic = excluded.bic,
                actual_id = COALESCE(
                    excluded.actual_id,
                    accounts.actual_id
                );
    `).run(
            account.connection_id,
            account.account_number,
            account.iban,
            account.name,
            account.actual_id ?? null,
            account.currency,
            account.balance,
            account.bank_country ?? null,
            account.bank_id ?? null,
            account.customer_id ?? null,
            account.account_type ?? null,
            account.holder1 ?? null,
            account.product ?? null,
            account.allowed_transactions == null
                ? null
                : JSON.stringify(account.allowed_transactions),
            account.is_sepa_account == null
                ? null
                : Number(account.is_sepa_account),
            account.bic ?? null
        );
    }

    saveAccountIdToAccount({
        connectionId,
        accountNumber,
        accountId,
    }) {
        const result = this.db.prepare(`
            UPDATE accounts
            SET actual_id = ?
            WHERE connection_id = ? AND account_number = ?;
        `).run(accountId, connectionId, accountNumber);
    }

    getAccounts() {
        const accounts = this.db.prepare(`
            SELECT
                bank_connections.bank_name,
                bank_connections.bank_abr,
                bank_connections.account_group_id,
                accounts.*
            FROM accounts
            LEFT JOIN bank_connections
                ON bank_connections.id = accounts.connection_id;
        `).all();
        return accounts;
    }

    getAccountIbans() {
        const ibans = this.db.prepare(`
            SELECT iban FROM accounts;
        `).all();
        return ibans.map(iban => iban.iban);
    }

    getAccountBalance(accountId) {
        const result = this.db.prepare(`
            SELECT COALESCE(SUM(amount), 0) AS amount
            FROM transactions
            WHERE account_id = ? AND pending = 0;
        `).get(accountId);
        return result;
    }

    getAccountsForConnection(bankConfig) {
        const connectionId = this.getBankConnectionId(bankConfig);
        const accounts = this.db.prepare(`
            SELECT 
                accounts.*,
                bank_connections.bank_abr,
                bank_connections.bank_name
            FROM accounts
            LEFT JOIN bank_connections
                ON accounts.connection_id = bank_connections.id
            WHERE connection_id = ?;
        `).all(connectionId);
        return accounts;
    }

    getAccount(connectionId, accountNumber) {
        return this.db.prepare(`
            SELECT * FROM accounts WHERE connection_id = ? AND account_number = ?;
        `).get(connectionId, accountNumber);
    }

    getAccountId(connectionId, accountNumber) {
        const account = this.getAccount(connectionId, accountNumber);
        return account.id;
    }

    saveTransaction(transaction) {
        return this.db.prepare(`
            INSERT INTO transactions (
                account_id,
                transaction_id,
                entry_date,
                value_date,
                amount,
                counterparty,
                counterparty_name,
                purpose,
                pending,
                funds_code,
                transaction_type,
                customer_reference,
                bank_reference,
                transaction_code,
                remote_name,
                remote_account_number,
                remote_bank_id,
                e2e_reference,
                mandate_reference,
                additional_information,
                booking_text
            )
            VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?
            )
            ON CONFLICT(account_id, transaction_id)
            DO UPDATE SET
                entry_date = excluded.entry_date,
                value_date = excluded.value_date,
                amount = excluded.amount,
                counterparty = excluded.counterparty,
                counterparty_name = excluded.counterparty_name,
                purpose = excluded.purpose,
                pending = excluded.pending,
                funds_code = excluded.funds_code,
                transaction_type = excluded.transaction_type,
                customer_reference = excluded.customer_reference,
                bank_reference = excluded.bank_reference,
                transaction_code = excluded.transaction_code,
                remote_name = excluded.remote_name,
                remote_account_number = excluded.remote_account_number,
                remote_bank_id = excluded.remote_bank_id,
                e2e_reference = excluded.e2e_reference,
                mandate_reference = excluded.mandate_reference,
                additional_information = excluded.additional_information,
                booking_text = excluded.booking_text;
    `).run(
            transaction.accountId,
            transaction.transactionId,
            transaction.entryDate,
            transaction.valueDate ?? null,
            transaction.amount,
            transaction.counterparty ?? null,
            transaction.counterpartyName ?? null,
            transaction.purpose ?? null,
            transaction.pending ?? 0,
            transaction.fundsCode ?? null,
            transaction.transactionType ?? null,
            transaction.customerReference ?? null,
            transaction.bankReference ?? null,
            transaction.transactionCode ?? null,
            transaction.remoteName ?? null,
            transaction.remoteAccountNumber ?? null,
            transaction.remoteBankId ?? null,
            transaction.e2eReference ?? null,
            transaction.mandateReference ?? null,
            transaction.additionalInformation ?? null,
            transaction.bookingText ?? null
        );
    }

    getTransactions() {
        return this.db.prepare(`
            SELECT 
                accounts.actual_id,
                transactions.*
            FROM transactions
            LEFT JOIN accounts
                ON accounts.id = transactions.account_id;
        `).all();
    }

    getTransactionsForAccount(accountId) {
        return this.db.prepare(`
            SELECT 
                accounts.actual_id,
                transactions.*
            FROM transactions
            JOIN accounts
                ON accounts.id = transactions.account_id
            WHERE transactions.account_id = ?
            ORDER BY transactions.entry_date;
        `).all(accountId);
    }

    getTransaction(accountId, transactionId) {
        return this.db.prepare(`
            SELECT * 
            FROM transactions
            WHERE account_id = ?
                AND transaction_id = ?;
        `).get(accountId, transactionId);
    }

    getTransferTransactions() {
        const results = this.db.prepare(`
            WITH
                normalized_transactions AS (
                    SELECT
                        t.*,
                        UPPER(
                            REPLACE(
                                COALESCE(
                                    NULLIF(TRIM(t.remote_account_number), ''),
                                    t.counterparty,
                                    ''
                                ),
                                ' ',
                                ''
                            )
                        ) AS normalized_counterparty_iban,
                        UPPER(TRIM(COALESCE(t.transaction_code, ''))) AS normalized_transaction_code
                    FROM
                        transactions t
                ),
                pairs AS (
                    SELECT
                        outgoing.id AS outgoing_row_id,
                        incoming.id AS incoming_row_id,
                        outgoing.transaction_id AS id_1,
                        incoming.transaction_id AS id_2,
                        source.actual_id AS actual_id_1,
                        target.actual_id AS actual_id_2,
                        outgoing.account_id AS account_id_1,
                        incoming.account_id AS account_id_2,
                        outgoing.entry_date AS entry_date,
                        incoming.entry_date AS entry_date_2,
                        outgoing.amount AS amount_1,
                        incoming.amount AS amount_2,
                        outgoing.purpose AS purpose_1,
                        incoming.purpose AS purpose_2,
                        outgoing.normalized_transaction_code AS outgoing_transaction_code,
                        incoming.normalized_transaction_code AS incoming_transaction_code,
                        CASE
                            WHEN LENGTH(outgoing.normalized_counterparty_iban) > 0
                            AND outgoing.normalized_counterparty_iban = UPPER(REPLACE(target.iban, ' ', '')) THEN 1
                            ELSE 0
                        END AS outgoing_iban_matches,
                        CASE
                            WHEN LENGTH(incoming.normalized_counterparty_iban) > 0
                            AND incoming.normalized_counterparty_iban = UPPER(REPLACE(source.iban, ' ', '')) THEN 1
                            ELSE 0
                        END AS incoming_iban_matches,
                        CASE
                            WHEN LENGTH(TRIM(COALESCE(outgoing.e2e_reference, ''))) > 0
                            AND UPPER(TRIM(outgoing.e2e_reference)) NOT IN ('NOTPROVIDED', 'NONREF', 'UNKNOWN', 'N/A')
                            AND UPPER(TRIM(outgoing.e2e_reference)) = UPPER(TRIM(incoming.e2e_reference)) THEN 1
                            ELSE 0
                        END AS e2e_matches
                    FROM
                        normalized_transactions outgoing
                        JOIN accounts source ON source.id = outgoing.account_id
                        JOIN normalized_transactions incoming ON incoming.amount = - outgoing.amount
                        AND incoming.amount > 0
                        AND incoming.account_id != outgoing.account_id
                        JOIN accounts target ON target.id = incoming.account_id
                    WHERE
                        outgoing.amount < 0
                        AND outgoing.pending = 0
                        AND incoming.pending = 0
                        AND source.currency = target.currency
                        AND source.actual_id IS NOT NULL
                        AND target.actual_id IS NOT NULL
                        AND julianday(substr(outgoing.entry_date, 1, 10)) IS NOT NULL
                        AND julianday(substr(incoming.entry_date, 1, 10)) IS NOT NULL
                        AND ABS(
                            julianday(substr(outgoing.entry_date, 1, 10)) - julianday(substr(incoming.entry_date, 1, 10))
                        ) <= 3
                        AND NOT EXISTS (
                            SELECT
                                1
                            FROM
                                accounts other
                            WHERE
                                other.id != target.id
                                AND LENGTH(outgoing.normalized_counterparty_iban) > 0
                                AND outgoing.normalized_counterparty_iban = UPPER(REPLACE(other.iban, ' ', ''))
                        )
                        AND NOT EXISTS (
                            SELECT
                                1
                            FROM
                                accounts other
                            WHERE
                                other.id != source.id
                                AND LENGTH(incoming.normalized_counterparty_iban) > 0
                                AND incoming.normalized_counterparty_iban = UPPER(REPLACE(other.iban, ' ', ''))
                        )
                ),
                eligible AS (
                    SELECT
                        *,
                        outgoing_iban_matches + incoming_iban_matches AS iban_score
                    FROM
                        pairs
                    WHERE
                        (
                            outgoing_iban_matches = 1
                            OR incoming_iban_matches = 1
                            OR substr(entry_date, 1, 10) = substr(entry_date_2, 1, 10)
                        )
                        AND NOT (
                            outgoing_iban_matches = 0
                            AND incoming_iban_matches = 0
                            AND outgoing_transaction_code = 'ESDD'
                            AND incoming_transaction_code = 'STDO'
                        )
                ),
                candidates AS (
                    SELECT
                        e.*,
                        e.iban_score * 10 + e.e2e_matches AS score,
                        COUNT(*) OVER (
                            PARTITION BY
                                e.outgoing_row_id
                        ) AS outgoing_candidate_count,
                        COUNT(*) OVER (
                            PARTITION BY
                                e.incoming_row_id
                        ) AS incoming_candidate_count
                    FROM
                        eligible e
                ),
                highest_outgoing AS (
                    SELECT
                        outgoing_row_id,
                        MAX(score) AS score
                    FROM
                        candidates
                    GROUP BY
                        outgoing_row_id
                ),
                highest_incoming AS (
                    SELECT
                        incoming_row_id,
                        MAX(score) AS score
                    FROM
                        candidates
                    GROUP BY
                        incoming_row_id
                ),
                preferred AS (
                    SELECT
                        c.*
                    FROM
                        candidates c
                        JOIN highest_outgoing o ON o.outgoing_row_id = c.outgoing_row_id
                        AND o.score = c.score
                        JOIN highest_incoming i ON i.incoming_row_id = c.incoming_row_id
                        AND i.score = c.score
                )
            SELECT
                json_array(p.outgoing_row_id, p.incoming_row_id) AS transaction_ids,
                p.id_1,
                p.id_2,
                p.actual_id_1,
                p.actual_id_2,
                p.account_id_1,
                p.account_id_2,
                p.entry_date,
                p.entry_date_2,
                p.amount_1,
                p.amount_2,
                p.purpose_1,
                p.purpose_2,
                CASE
                    WHEN p.iban_score = 2 THEN 'iban_both'
                    WHEN p.iban_score = 1 THEN 'iban_one'
                    WHEN p.e2e_matches = 1 THEN 'amount_date_e2e'
                    ELSE 'amount_date'
                END AS match_type,
                p.e2e_matches AS e2e_reference_matches
            FROM
                preferred p
            WHERE
                (
                    SELECT
                        COUNT(*)
                    FROM
                        preferred x
                    WHERE
                        x.outgoing_row_id = p.outgoing_row_id
                ) = 1
                AND (
                    SELECT
                        COUNT(*)
                    FROM
                        preferred x
                    WHERE
                        x.incoming_row_id = p.incoming_row_id
                ) = 1
                AND (
                    p.iban_score > 0
                    OR (
                        p.outgoing_candidate_count = 1
                        AND p.incoming_candidate_count = 1
                    )
                )
            ORDER BY
                p.entry_date,
                p.outgoing_row_id;
        `).all();
        return results;
    }

    saveSyncId(syncID, name) {
        return this.db.prepare(`
            INSERT INTO actual_budget (
                sync_id,
                name
            )
            VALUES (?, ?)

            ON CONFLICT(sync_id)
            DO NOTHING
        `).run(syncID, name);
    }

    getSyncId(name) {
        return this.db.prepare(`
            SELECT * FROM actual_budget WHERE name = ?
        `).get(name);
    }

    deleteSyncId(sync_id) {
        return this.db.prepare(`
            DELETE FROM actual_budget WHERE sync_id = ?
        `).run(sync_id);
    }

    getLastFetchedAt(accountId) {
        const result = this.db.prepare(`
            SELECT last_fetched_at
            FROM accounts
            WHERE id = ?
        `).get(accountId);

        return result?.last_fetched_at ?? null;
    }

    setLastFetchedAt(accountId, timestamp) {
        const result = this.db.prepare(`
            UPDATE accounts
            SET last_fetched_at = ?
            WHERE id = ?
        `).run(timestamp, accountId);

        if (result.changes !== 1) {
            throw new Error(`Unknown SQLite account: ${accountId}`);
        }
    }

    saveFetchedTransactions(accountId, transactions, fetchedAt) {
        const commit = this.db.transaction(() => {
            for (const transaction of transactions) {
                this.saveTransaction({ ...transaction, accountId });
            }
            this.setLastFetchedAt(accountId, fetchedAt);
        });
        commit();
    }

    linkActualAccount({ connectionId, accountNumber, actualId, needsOpening }) {
        const result = this.db.prepare(`
            UPDATE accounts
            SET actual_id = ?, opening_balance_pending = ?
            WHERE connection_id = ? AND account_number = ?
        `).run(actualId, needsOpening ? 1 : 0, connectionId, accountNumber);

        if (result.changes !== 1) {
            throw new Error(`Cannot map bank account ${accountNumber}`);
        }
    }

    markOpeningBalanceSynced(accountId) {
        const result = this.db.prepare(`
            UPDATE accounts
            SET opening_balance_pending = 0
            WHERE id = ?
        `).run(accountId);
        if (result.changes !== 1) {
            throw new Error(`Unknown SQLite account: ${accountId}`);
        }
    }

    createSimpleFinClaim(tokenHash, expiresAt) {
        this.db.prepare(`
            INSERT INTO simplefin_claim_tokens (token_hash, expires_at)
            VALUES (?, ?)
        `).run(tokenHash, expiresAt);
    }

    consumeSimpleFinClaim(tokenHash, credentialHash, nowSeconds) {
        const claim = this.db.transaction(() => {
            const deleted = this.db.prepare(`
                DELETE FROM simplefin_claim_tokens
                WHERE token_hash = ? AND expires_at >= ?
            `).run(tokenHash, nowSeconds);
            if (deleted.changes !== 1) return false;
            this.db.prepare(`
                INSERT INTO simplefin_access_credentials (credential_hash, created_at)
                VALUES (?, ?)
            `).run(credentialHash, nowSeconds);
            return true;
        });
        return claim();
    }

    hasSimpleFinCredential(credentialHash) {
        return Boolean(this.db.prepare(`
            SELECT 1 FROM simplefin_access_credentials WHERE credential_hash = ?
        `).get(credentialHash));
    }

    revokeSimpleFinCredentials() {
        const revoke = this.db.transaction(() => {
            this.db.prepare('DELETE FROM simplefin_claim_tokens').run();
            return this.db.prepare('DELETE FROM simplefin_access_credentials').run().changes;
        });
        return revoke();
    }

    close() {
        this.db.close();
    }
}