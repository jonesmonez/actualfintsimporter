export function getFetchPeriod(
    lastFetchedAt,
    overlapDays = 7,
    initialDays = 365
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
