import { getLogger } from './logger.js';
const logg = getLogger('refresh-man');

export class RefreshManager {
    constructor(fetchAll, { minAgeMs = 60000, log = logg } = {}) {
        this.fetchAll = fetchAll;
        this.minAgeMs = minAgeMs;
        this.log = log;
        this.inFlight = null;
        this.lastSuccess = 0;
        this.lastFailure = 0;
        this.lastError = null;
    }

    request({ force = false } = {}) {
        if (this.inFlight) {
            return this.inFlight;
        }

        if (!force && this.lastSuccess && Date.now() - this.lastSuccess < this.minAgeMs) {
            return Promise.resolve();
        }

        if (!force && this.lastFailure && Date.now() - this.lastFailure < this.minAgeMs) {
            return Promise.reject(this.lastError);
        }

        this.inFlight = (async () => {
            try {
                await this.fetchAll();
                this.lastSuccess = Date.now();
                this.lastFailure = 0;
                this.lastError = null;
                this.log.info('FinTS refresh completed');
            } catch (error) {
                this.lastFailure = Date.now();
                this.lastError = error;
                this.log.error('FinTS refresh failed:', error);
                throw error;
            } finally {
                this.inFlight = null;
            }
        })();
        return this.inFlight;
    }
}

export async function waitForRefresh(refreshPromise, timeoutMs) {
    let timeout;
    try {
        return await Promise.race([
            Promise.resolve(refreshPromise).then(() => ({ status: 'fresh' }), () => ({ status: 'failed' })),
            new Promise(resolve => { timeout = setTimeout(() => resolve({ status: 'updating' }), timeoutMs); }),
        ]);
    } finally {
        clearTimeout(timeout);
    }
}
