import { getLogger } from './logger.js';
const log = getLogger('sync-coord');

export class SyncCoordinator {
    constructor() {
        this.queues = new Map();
    }

    async schedule(connectionId, syncFunction) {
        log.debug(`Starting a job for connection ${connectionId}`);

        const previous = this.queues.get(connectionId) ?? Promise.resolve();
        const current = previous
            .catch(() => { })
            .then(() => syncFunction());
        this.queues.set(connectionId, current);

        const cleanup = () => {
            log.debug(`A job for connection ${connectionId} finished`);
            if (this.queues.get(connectionId) === current) {
                log.debug(`Last job for connection ${connectionId}, cleaning up`);
                this.queues.delete(connectionId);
            }
        }

        current.then(cleanup, cleanup);
        return current;
    }

    async waitForIdle() {
        await Promise.allSettled([...this.queues.values()]);
    }
}