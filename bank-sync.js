import { FinTSHandler } from './fints.js';
import * as api from '@actual-app/api';
import { getSecret } from './secrets.js';

import { getLogger } from './logger.js';
const log = getLogger('bank-sync');

export function getCredentials(bank) {
    const bankName = bank.toUpperCase();
    const config = {
        user: process.env[`${bankName}_USR`],
        pin: getSecret(`${bankName}_PIN`),
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

function getFetchPeriod(
    lastFetchedAt,
    overlapDays = 7,
    initialDays = Number(process.env.FINTS_INITIAL_FETCH_DAYS ?? 365)
) {
    const to = new Date();

    const from = lastFetchedAt
        ? new Date(lastFetchedAt)
        : new Date(to);

    const days = lastFetchedAt
        ? overlapDays
        : initialDays;

    from.setUTCDate(from.getUTCDate() - days);

    return { from, to };
}

export async function syncFinTSAccount(db, fin, account) {
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
    log.info(`Fetched ${transactions.length} bank transactions for ${accountNumber}`);
}

export async function fetchAllBanks(db) {
    const banks = (process.env.BANKS ?? '')
        .split(',')
        .map(bank => bank.trim())
        .filter(Boolean);

    if (banks.length === 0) {
        throw new Error('BANKS must contain at least one bank');
    }

    for (const name of banks) {
        log.info(`Fetching information for ${name}`);
        const config = getCredentials(name);
        db.createBankConnection(config);
        const fin = new FinTSHandler(
            config,
            bankingInfo => db.updateBankingInformation(config, bankingInfo)
        );
        await fin.connect(db.getBankingInformation(config));
        db.updateBankNameForBankConnection(config, fin.getBank());
        for (const account of await fin.getAccounts()) {
            await syncFinTSAccount(db, fin, account);
        }
    }
}
