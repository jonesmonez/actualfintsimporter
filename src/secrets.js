import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';

import { getLogger } from './logger.js';
const log = getLogger('secrets');

const secretsPath = '/run/secrets/app.env';

const fileSecrets = existsSync(secretsPath)
    ? parse(readFileSync(secretsPath))
    : {};

export function getSecret(name) {
    if (process.env[name]) {
        log.debug(`Using ${name} from env vars`);
    } else {
        log.debug(`Using ${name} from secret file`);
    }
    return process.env[name] ?? fileSecrets[name];
}