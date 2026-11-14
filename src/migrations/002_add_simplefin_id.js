export default {
    version: 2,

    up(db) {
        db.exec(`
            ALTER TABLE accounts ADD COLUMN simplefin_id TEXT;
            ALTER TABLE accounts ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_simplefin_id ON accounts(simplefin_id);
        `);
    }
};