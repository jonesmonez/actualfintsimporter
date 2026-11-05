export function centsToDecimal(cents) {
    if (!Number.isSafeInteger(cents)) throw new Error('Amount is not an integer number of cents');
    const abs = Math.abs(cents);
    return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function dayToUnixNoon(dateString) {
    const text = String(dateString ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`Invalid bank date: ${text}`);
    const timestamp = Date.parse(`${text}T12:00:00.000Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== text) {
        throw new Error(`Invalid bank date: ${text}`);
    }
    return Math.floor(timestamp / 1000);
}

export function toSimpleFinTransaction(row) {
    const pending = row.pending === 1;
    const posted = dayToUnixNoon(row.entry_date ?? row.value_date);
    return {
        id: String(row.transaction_id),
        posted: pending ? 0 : posted,
        ...(pending ? { transacted_at: posted, pending: true } : {}),
        amount: centsToDecimal(row.amount),
        payee: row.counterparty_name ?? row.remote_name ?? undefined,
        description: row.purpose ?? row.additional_information ?? row.booking_text ?? row.counterparty_name ?? 'Bank transaction',
    };
}

function epochBoundary(params, name) {
    const value = params.get(name);
    if (value === null) return null;
    if (!/^\d+(?:\.\d+)?$/.test(value)) throw new RangeError(`Invalid ${name}`);
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 8640000000000) throw new RangeError(`Invalid ${name}`);
    return number;
}

export function makeAccountSet(db, params, bridgeUrl) {
    const start = epochBoundary(params, 'start-date');
    const end = epochBoundary(params, 'end-date');
    if (start != null && end != null && end < start) {
        throw new RangeError('end-date must be after start-date');
    }

    const ids = params.getAll('account');
    const includedIds = ids.length ? new Set(ids) : null;
    const onlyBalances = params.get('balances-only') === '1';
    const includePending = params.get('pending') === '1';
    const accounts = db.getAccounts()
        .filter(account => !includedIds || includedIds.has(`fints-${account.id}`))
        .map(account => {
            const cachedDate = account.last_fetched_at
                ? Math.floor(new Date(account.last_fetched_at).getTime() / 1000)
                : Math.floor(Date.now() / 1000);
            const transactions = onlyBalances ? [] : db.getTransactionsForAccount(account.id)
                .filter(row => includePending || row.pending !== 1)
                .map(toSimpleFinTransaction)
                .filter(row => {
                    const date = row.pending ? row.transacted_at : row.posted;
                    return (start == null || date >= start) && (end == null || date < end);
                })
                .sort((a, b) => (a.posted || a.transacted_at) - (b.posted || b.transacted_at));

            return {
                org: {
                    name: account.bank_name || account.bank_abr || 'FinTS bank',
                    id: `fints-bank-${account.connection_id}`,
                    'sfin-url': bridgeUrl,
                },
                id: `fints-${account.id}`,
                name: `${account.name} (${String(account.iban).slice(-4)})`,
                currency: account.currency,
                balance: centsToDecimal(account.balance),
                'balance-date': Number.isFinite(cachedDate) ? cachedDate : Math.floor(Date.now() / 1000),
                transactions,
            };
        });

    return { errors: [], accounts };
}
