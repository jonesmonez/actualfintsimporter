import { DatabaseHandler } from './db.js';
import { fetchAllBanks } from './bank-sync.js';
import { createSimpleFinHttpServer } from './simplefin-http.js';
import { RefreshManager } from './refresh-manager.js';

import { getLogger } from './logger.js';
const log = getLogger('simplefin-sever');

function positiveIntegerEnv(name, defaultValue, min = 1, max = Number.MAX_SAFE_INTEGER) {
    const value = process.env[name] === undefined ? defaultValue : Number(process.env[name]);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`${name} must be an integer from ${min} to ${max}`);
    }
    return value;
}

export async function runSimpleFin() {
    const publicUrl = process.env.SIMPLEFIN_PUBLIC_URL;
    const adminToken = process.env.SIMPLEFIN_ADMIN_TOKEN;
    if (!publicUrl || !adminToken) {
        throw new Error('SIMPLEFIN_PUBLIC_URL and SIMPLEFIN_ADMIN_TOKEN are required');
    }

    const url = new URL(publicUrl);
    if (url.protocol === 'http:' && process.env.SIMPLEFIN_ALLOW_HTTP !== 'true') {
        throw new Error('For an HTTP bridge confined to a private network, set SIMPLEFIN_ALLOW_HTTP=true (otherwise use HTTPS)');
    }

    const port = positiveIntegerEnv('SIMPLEFIN_PORT', 3001, 1, 65535);
    const minAgeSeconds = positiveIntegerEnv('SIMPLEFIN_REFRESH_MIN_AGE_SECONDS', 60, 0);
    const waitMs = positiveIntegerEnv('SIMPLEFIN_ON_DEMAND_WAIT_MS', 20000, 1, 300000);
    const host = process.env.SIMPLEFIN_HOST || '127.0.0.1';
    if ((process.env.BANKS ?? '').split(',').every(bank => !bank.trim())) {
        throw new Error('BANKS must contain at least one configured bank');
    }

    const db = new DatabaseHandler(process.env.DB_PATH || 'bank.db');
    let refresh;
    let server;

    try {
        refresh = new RefreshManager(() => fetchAllBanks(db), { minAgeMs: minAgeSeconds * 1000 });
        server = createSimpleFinHttpServer({ db, refresh, publicUrl, adminToken, waitMs });
        await new Promise((resolve, reject) => {
            function onListening() { server.off('error', onError); resolve(); }
            function onError(error) { server.off('listening', onListening); reject(error); }
            server.once('error', onError);
            server.once('listening', onListening);
            server.listen(port, host);
        });
    } catch (error) {
        db.close();
        throw error;
    }
    server.on('error', error => log.error('SimpleFIN HTTP server error:', error));
    log.info(`SimpleFIN v1 bridge listening on ${host}:${port}`);
    log.info('FinTS refresh: on-demand only; no direct imports to Actual');
    if (url.protocol === 'http:') {
        log.warn('HTTP mode enabled: only use on a private, trusted Docker network. Never publish this port publicly.');
    }

    let shuttingDown = false;
    async function shutdown() {
        if (shuttingDown) return;
        shuttingDown = true;

        await new Promise(resolve => server.close(resolve));
        if (refresh.inFlight) {
            await refresh.inFlight.catch(() => { });
        }
        db.close();
    }
    process.once('SIGINT', () => { void shutdown().then(() => { process.exitCode = 0; }); });
    process.once('SIGTERM', () => { void shutdown().then(() => { process.exitCode = 0; }); });
    return server;
}
