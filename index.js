import 'dotenv/config';
import { FinTSHandler } from './fints.js';
import { DatabaseHandler } from './db.js';

import * as api from '@actual-app/api';
import { getFetchPeriod } from './sync.js';

function getCredentials(bank) {
    const bankName = bank.toUpperCase();
    const config = {
        user: process.env[`${bankName}_USR`],
        pin: process.env[`${bankName}_PIN`],
        blz: process.env[`${bankName}_BLZ`],
        url: process.env[`${bankName}_URL`],
        pid: process.env.FINTS_PRODUCT_ID,
        bank: bank,
    };
    for (const key of ['user', 'pin', 'blz', 'url', 'pid']) {
        if (!config[key]) {
            throw new Error(`Missing ${key} configuration for bank ${bank}`);
        }
    }
    return config;
}

function bankDate(value, label) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        return value.slice(0, 10);
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`Invalid ${label}: ${String(value)}`);
    }
    return date.toISOString().slice(0, 10);
}

async function syncFinTSAccount(db, fin, account) {
    const connectionId = db.getBankConnectionId(fin);
    const accountNumber = account.accountNumber;
    const balanceResponse = await fin.getBalance(account);
    const reportedBalance = balanceResponse?.balance?.balance;
    if (typeof reportedBalance !== 'number' || !Number.isFinite(reportedBalance)) {
        throw new Error(`Bank returned no numeric balance for ${accountNumber}`);
    }

    db.saveAccount({
        connection_id: connectionId,
        account_number: accountNumber,
        iban: account.iban,
        name: account.product ?? account.iban,
        actual_id: null,
        currency: account.currency,
        balance: api.utils.amountToInteger(reportedBalance),

        bank_country: account.bank?.country ?? null,
        bank_id: account.bank?.bankId ?? null,

        customer_id: account.customerId ?? null,
        account_type: account.accountType ?? null,
        holder1: account.holder1 ?? null,
        product: account.product ?? null,
        allowed_transactions: account.allowedTransactions ?? null,
        is_sepa_account: account.isSepaAccount ?? null,
        bic: account.bic ?? null,
    });

    const localAccount = db.getAccount(connectionId, accountNumber);
    const lastFetchedAt = db.getLastFetchedAt(localAccount.id);
    const { from, to } = getFetchPeriod(lastFetchedAt);
    const response = await fin.getStatements(account, from, to);
    if (!Array.isArray(response?.statements)) {
        throw new Error(`Missing statements for ${accountNumber}`);
    }
    const bankAbr = await fin.getBankAbr();

    const transactions = response.statements.flatMap(statement => statement.transactions ?? [])
        .map(transaction => {
            const amount = api.utils.amountToInteger(transaction.amount);

            if (!Number.isSafeInteger(amount)) {
                throw new Error(`Invalid transaction amount for ${accountNumber}`);
            }

            return {
                transactionId: bankAbr + transaction.bankReference,
                entryDate: bankDate(transaction.entryDate, 'entry date'),
                valueDate: transaction.valueDate
                    ? bankDate(transaction.valueDate, 'value date')
                    : null,
                amount,
                counterparty: transaction.remoteAccountNumber ?? null,
                counterpartyName: transaction.remoteName ?? null,

                fundsCode: transaction.fundsCode ?? null,
                transactionType: transaction.transactionType ?? null,
                customerReference: transaction.customerReference ?? null,
                bankReference: transaction.bankReference ?? null,
                transactionCode: transaction.transactionCode ?? null,

                remoteName: transaction.remoteName ?? null,
                remoteAccountNumber: transaction.remoteAccountNumber ?? null,
                remoteBankId: transaction.remoteBankId ?? null,

                e2eReference: transaction.e2eReference ?? null,
                mandateReference: transaction.mandateReference ?? null,

                purpose: transaction.purpose ?? null,
                additionalInformation: transaction.additionalInformation ?? null,
                bookingText: transaction.bookingText ?? null,

                pending: transaction.pending === true ? 1 : 0,
            };
        });

    db.saveFetchedTransactions(localAccount.id, transactions, to.toISOString());
    console.log(`Fetched ${transactions.length} bank transactions for ${accountNumber}`);
}

async function ensureAccountGroup(db, bankConnecion) {
    const groups = await api.getAccountGroups();
    const matches = groups.filter(group =>
        group.name === bankConnecion.bank_name
    );

    if (matches.length > 1) {
        throw new Error(`Amiguous account grop name: ${bankConnecion.bank_name}`);
    }
    const groupId = matches.length
        ? matches[0].id
        : await api.createAccountGroup({ name: bankConnecion.bank_name });

    if (bankConnecion.account_group_id !== groupId) {
        db.updateGroupIdForBankConnection(bankConnecion, groupId);
    }
    return groupId;
}

async function ensureActualAccount(
    db,
    fintsAccount,
    actualAccountGroupId
) {
    const actualAccounts = await api.getAccounts();

    if (fintsAccount.actual_id) {
        const existing = actualAccounts.find(
            account => account.id === fintsAccount.actual_id
        );

        if (!existing) {
            throw new Error(`Mapped Actual account not found: ${fintsAccount.actual_id}`);
        }

        return existing.id;
    }

    const suffix = fintsAccount.iban.slice(-4);
    const accountName = `${fintsAccount.name} (${fintsAccount.bank_abr} • ${suffix})`;

    const matches = actualAccounts.filter(account =>
        account.name === accountName &&
        account.account_group_id === actualAccountGroupId
    );

    if (matches.length > 1) {
        throw new Error(`Amiguous Actual account: ${accountName}`);
    }

    const actualId = matches.length === 1
        ? matches[0].id
        : await api.createAccount({ name: accountName });

    if (matches.length === 0) {
        await api.updateAccount(actualId, {
            account_group_id: actualAccountGroupId
        });
    }

    db.linkActualAccount({
        connectionId: fintsAccount.connection_id,
        accountNumber: fintsAccount.account_number,
        actualId,
        needsOpening: matches.length === 0
    });

    return actualId;
}

async function importNormalTransactions(db, fintsAccount, transferRowIds) {
    const transactions = db.getTransactionsForAccount(fintsAccount.id);
    const actualTransactions = [];

    if (fintsAccount.opening_balance_pending === 1) {
        const booked = transactions.filter(row => row.pending === 0);
        const sum = db.getAccountBalance(fintsAccount.id).amount;
        const openingBalance = fintsAccount.balance - sum;
        const firstDate = booked.length
            ? booked.map(row => row.entry_date.slice(0, 10)).sort()[0]
            : new Date().toISOString().slice(0, 10);
        const openingDate = new Date(`${firstDate}T00:00:00Z`);
        openingDate.setUTCDate(openingDate.getUTCDate() - 1);

        const category = (await api.getCategories()).find(c => c.name === 'Starting Balances');
        if (!category) {
            throw new Error('Actual category "Starting Balances" not found');
        }
        actualTransactions.push({
            date: openingDate.toISOString().slice(0, 10),
            amount: openingBalance,
            category: category.id,
            payee_name: 'Starting Balance Adjustment',
            imported_payee: 'Starting Balance Adjustment',
            imported_id: `OPENING:${fintsAccount.actual_id}`,
            notes: 'Initial balance adjustment for the imported bank history',
            cleared: true,
        });
    }

    for (const transaction of transactions) {
        if (transaction.pending !== 0) continue;
        if (transferRowIds.has(transaction.id)) {
            continue;
        }
        actualTransactions.push({
            date: transaction.entry_date.slice(0, 10),
            amount: transaction.amount,
            payee_name: transaction.counterparty_name ?? undefined,
            imported_payee: transaction.counterparty_name ?? undefined,
            notes: transaction.purpose ?? undefined,
            imported_id: transaction.transaction_id,
            cleared: transaction.pending === 0,
        });
    }

    if (actualTransactions.length === 0) {
        return;
    }

    const result = await api.importTransactions(fintsAccount.actual_id, actualTransactions, {
        reimportDeleted: false,
    });
    if (!result || !Array.isArray(result.errors)) {
        throw new Error(`Unexpected Actual import result for ${fintsAccount.actual_id}`);
    }
    if (result.errors.length) {
        throw new Error(`Actual import failed: ${JSON.stringify(result.errors)}`);
    }
    console.log(`Actual account ${fintsAccount.actual_id}: ` +
        `${result.added?.length ?? 0} added, ${result.updated?.length ?? 0} updated`);
}

async function importTransfer(transfer) {
    const date = transfer.entry_date.slice(0, 10);
    const start = new Date(`${date}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 30);

    const end = new Date(`${date}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 30);

    const from = start.toISOString().slice(0, 10);
    const to = end.toISOString().slice(0, 10);

    const [payees, leftRows, rightRows] = await Promise.all([
        api.getPayees(),
        api.getTransactions(transfer.actual_id_1, from, to),
        api.getTransactions(transfer.actual_id_2, from, to),
    ]);
    let left = leftRows.find(t => t.imported_id === transfer.id_1);
    const existingRight = rightRows.find(t => t.imported_id === transfer.id_2);

    if (!left && existingRight) {
        throw new Error(`Transfer ${transfer.id_1}: incoming side exists without outgoing side; manual reconciliation required`);
    }

    if (!left) {
        const payee = payees.find(p => p.transfer_acct === transfer.actual_id_2);
        if (!payee) {
            throw new Error(`No transfer payee for account ${transfer.actual_id_2}`);
        }
        await api.addTransactions(transfer.actual_id_1, [{
            date,
            amount: transfer.amount_1,
            payee: payee.id,
            notes: transfer.purpose_1,
            imported_id: transfer.id_1,
            cleared: true,
        }], { runTransfers: true });

        const refreshed = await api.getTransactions(transfer.actual_id_1, from, to);
        left = refreshed.find(t => t.imported_id === transfer.id_1);

        if (!left) {
            throw new Error(`Outgoing transaction was not created: ${transfer.id_1}`);
        }

        const pair = await waitForTransferLink(transfer, left.id, from, to);

        left = pair.left;

        await api.sync();
    }

    if (left && !left.transfer_id) {
        if (existingRight) {
            throw new Error(`Both sides of transfer ${transfer.id_1} exist but are not linked; manual reconciliation required`);
        }

        const payee = payees.find(p =>
            p.transfer_acct === transfer.actual_id_2
        );

        if (!payee) {
            throw new Error(`No transfer payee for ${transfer.actual_id_2}`);
        }

        if (left.payee_id !== payee.id) {
            await api.updateTransaction(
                left.id,
                { payee: payee.id }
            );
        }

        const pair = await waitForTransferLink(transfer, left.id, from, to);

        left = pair.left;

        await api.sync();
    }

    if (!left?.transfer_id) {
        throw new Error(`Transfer link was not created for ${transfer.id_1}`);
    }

    const refreshedRight = await api.getTransactions(transfer.actual_id_2, from, to);
    const right = refreshedRight.find(t => t.id === left.transfer_id);

    if (!right) {
        throw new Error(`Missing linked counterpart for ${transfer.id_1}`);
    }

    if (existingRight && existingRight.id !== right.id) {
        throw new Error(`Duplicate unlinked incoming transaction for ${transfer.id_2}; review manually`);
    }

    if (right.imported_id && ![transfer.id_1, transfer.id_2].includes(right.imported_id)) {
        throw new Error(`Unexpected imported ID on transfer counterpart ${right.id}`);
    }

    const incomingDate = transfer.entry_date_2.slice(0, 10);

    if (
        right.imported_id !== transfer.id_2 ||
        right.date !== incomingDate ||
        !right.cleared
    ) {
        await api.updateTransaction(right.id, {
            imported_id: transfer.id_2,
            date: incomingDate,
            notes: transfer.purpose_2,
            cleared: true,
        });

        await waitForIncomingUpdate(transfer, right.id, from, to);
        await api.sync();
    }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForTransferLink(
    transfer,
    outgoingId,
    from,
    to
) {
    for (let attempt = 0; attempt < 30; attempt++) {
        const outgoingRows = await api.getTransactions(
            transfer.actual_id_1,
            from,
            to
        );

        const left = outgoingRows.find(t =>
            t.id === outgoingId
        );

        if (left?.transfer_id) {
            const incomingRows = await api.getTransactions(
                transfer.actual_id_2,
                from,
                to
            );

            const right = incomingRows.find(t =>
                t.id === left.transfer_id
            );

            if (
                right &&
                right.transfer_id === left.id &&
                right.amount === -left.amount
            ) {
                return { left, right };
            }
        }

        await sleep(250);
    }

    throw new Error(`Transfer link not completed for ${transfer.id_1}`);
}

async function waitForIncomingUpdate(
    transfer,
    rightId,
    from,
    to
) {
    const expectedDate =
        transfer.entry_date_2.slice(0, 10);

    for (let attempt = 0; attempt < 30; attempt++) {
        const rows = await api.getTransactions(
            transfer.actual_id_2,
            from,
            to
        );

        const right = rows.find(t => t.id === rightId);

        if (
            right?.imported_id === transfer.id_2 &&
            right.date === expectedDate &&
            right.cleared === true
        ) {
            return;
        }

        await sleep(250);
    }

    throw new Error(`Incoming transfer update not completed: ${transfer.id_2}`);
}

async function main() {
    const db = new DatabaseHandler(process.env.DB_PATH || 'bank.db');

    let actualInitialized = false;

    try {
        if (!process.env.ACTUAL_SYNC_ID || !process.env.ACTUAL_SERVER_URL || !process.env.ACTUAL_PASSWORD) {
            throw new Error('ACTUAL_SYNC_ID, ACTUAL_SERVER_URL and ACTUAL_PASSWORD must be set');
        }

        await api.init({
            serverURL: process.env.ACTUAL_SERVER_URL,
            password: process.env.ACTUAL_PASSWORD,
            verbose: false,
            dataDir: './actual-data',
        });

        actualInitialized = true;

        const options = process.env.ACTUAL_E2E
            ? { password: process.env.ACTUAL_E2E }
            : undefined;

        await api.downloadBudget(
            process.env.ACTUAL_SYNC_ID,
            options
        );

        const banks = (process.env.BANKS ?? '')
            .split(',')
            .map(bank => bank.trim())
            .filter(Boolean);

        if (banks.length === 0) {
            throw new Error('BANKS must contain at least one bank');
        }

        for (const name of banks) {
            const config = getCredentials(name);

            db.createBankConnection(config);

            const fin = new FinTSHandler(
                config,
                bankingInfo => db.updateBankingInformation(
                    config,
                    bankingInfo
                )
            );

            await fin.connect(db.getBankingInformation(config));

            db.updateBankNameForBankConnection(config, fin.getBank());

            for (const account of await fin.getAccounts()) {
                await syncFinTSAccount(db, fin, account);
            }
        }

        const bankConnections = db.getBankConnections();
        for (const bankConnection of bankConnections) {
            const groupId = await ensureAccountGroup(db, bankConnection);
            const accounts = db.getAccountsForConnection(bankConnection);
            for (const account of accounts) {
                await ensureActualAccount(db, account, groupId);
            }
        }

        const transfers = db.getTransferTransactions();
        const transferRowIds = new Set(transfers.flatMap(row => JSON.parse(row.transaction_ids)));
        const accounts = db.getAccounts();

        for (const account of accounts) {
            if (!account.actual_id) {
                throw new Error(`No Actual mapping for account ${account.id}`);
            }

            await importNormalTransactions(db, account, transferRowIds);
        }
        await api.sync();

        for (const account of accounts) {
            if (account.opening_balance_pending === 1) {
                db.markOpeningBalanceSynced(account.id);
            }
        }

        for (const transfer of transfers) {
            await importTransfer(transfer);
        }
        await api.sync();

        for (const account of db.getAccounts()) {
            if (!account.actual_id) continue;
            const actualBalance = await api.getAccountBalance(account.actual_id);
            const diff = account.balance - actualBalance;
            if (diff !== 0) {
                console.warn(`Balance mismatch for account ${account.id}: ` + api.utils.integerToAmount(diff));
            }
        }
    } finally {
        try {
            if (actualInitialized) {
                await api.shutdown();
            }
        } finally {
            db.close();
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});