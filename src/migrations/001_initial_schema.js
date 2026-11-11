export default {
    version: 1,

    up(db) {
        db.exec(`
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

                actual_id TEXT,

                iban TEXT NOT NULL,
                name TEXT NOT NULL,
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
        `);
    }
};