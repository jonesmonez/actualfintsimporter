import 'dotenv/config';

import { apiPush } from './api-push.js';
import { runSimpleFin } from './simplefin-server.js';

import { getLogger } from './logger.js';
const log = getLogger();

const mode = (process.env.SYNC_MODE ?? 'simplefin').toLowerCase();
const entrypoint = mode === 'apipush'
    ? apiPush
    : mode === 'simplefin'
        ? runSimpleFin
        : async () => { throw new Error(`Invalid SYNC_MODE ${mode}: expected actual or simplefin`); };

log.info(`Starting in ${mode}-mode`);
log.debug('Debug-Mode activated')

entrypoint().catch((error) => {
    log.error(error);
    process.exitCode = 1;
});