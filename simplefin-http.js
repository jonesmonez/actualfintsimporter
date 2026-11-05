import http from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { makeAccountSet } from './simplefin-protocol.js';
import { waitForRefresh } from './refresh-manager.js';

import { getLogger } from './logger.js';
const log = getLogger('simplefin-http');

const digest = value => createHash('sha256').update(value).digest('hex');
const randomSecret = () => randomBytes(32).toString('hex');

function equalSecrets(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') {
        return false;
    }

    const a = Buffer.from(digest(left), 'hex');
    const b = Buffer.from(digest(right), 'hex');

    return timingSafeEqual(a, b);
}

function reply(res, status, body, contentType = 'text/plain; charset=utf-8') {
    res.writeHead(status, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
}

function isAuthorized(res, req, db) {
    const value = req.headers.authorization;
    if (typeof value !== 'string' || !value.startsWith('Basic ') || value.length > 1024) {
        reply(res, 403, 'Forbidden');
        return false;
    }

    const raw = Buffer.from(value.slice(6), 'base64').toString('utf8');
    const separator = raw.indexOf(':');
    if (separator <= 0 || separator === raw.length - 1 || !db.hasSimpleFinCredential(digest(raw))) {
        reply(res, 403, 'Forbidden');
        return false;
    }

    return true;
}

export function createSimpleFinHttpServer({ db, refresh, publicUrl, adminToken, waitMs = 20000 }) {
    if (!adminToken || adminToken.length < 24) {
        throw new Error('SIMPLEFIN_ADMIN_TOKEN must contain at least 24 random characters');
    }

    const base = new URL(publicUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.pathname !== '/simplefin' || base.username || base.password || base.search || base.hash) {
        throw new Error('SIMPLEFIN_PUBLIC_URL must be an http(s) URL ending in /simplefin (no credentials, query or fragment)');
    }

    return http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://localhost');
            const path = url.pathname;
            const isAdmin = equalSecrets(req.headers.authorization, `Bearer ${adminToken}`);
            if (req.method === 'GET' && path === '/health') {
                return reply(res, 200, 'ok');
            }

            if (req.method === 'GET' && path === '/simplefin/info') {
                return reply(res, 200, JSON.stringify({ versions: ['1.0'] }), 'application/json; charset=utf-8');
            }

            if (req.method === 'GET' && path === '/simplefin/create') {
                if (!isAdmin) {
                    return reply(res, 403, 'Forbidden');
                }

                const claim = randomSecret();
                db.createSimpleFinClaim(digest(claim), Math.floor(Date.now() / 1000) + 3600);
                const token = Buffer.from(`${publicUrl}/claim/${claim}`, 'utf8').toString('base64');
                return reply(res, 200, token + '\n');
            }

            if (req.method === 'POST' && path.startsWith('/simplefin/claim/')) {
                const claim = path.slice('/simplefin/claim/'.length);
                if (!/^[a-f0-9]{64}$/.test(claim)) {
                    return reply(res, 403, 'Forbidden');
                }

                const username = randomSecret();
                const password = randomSecret();
                const authorized = db.consumeSimpleFinClaim(
                    digest(claim), digest(`${username}:${password}`), Math.floor(Date.now() / 1000)
                );

                if (!authorized) {
                    return reply(res, 403, 'Forbidden');
                }

                const access = new URL(publicUrl);
                access.username = username;
                access.password = password;
                return reply(res, 200, access.toString() + '\n');
            }

            if (req.method === 'POST' && path === '/simplefin/revoke') {
                if (!isAdmin) {
                    return reply(res, 403, 'Forbidden');
                }

                const count = db.revokeSimpleFinCredentials();
                return reply(res, 200, JSON.stringify({ revokedCredentials: count }), 'application/json; charset=utf-8');
            }

            if (req.method === 'GET' && path === '/simplefin/accounts') {
                if (!isAuthorized(res, req, db)) return;

                const refreshed = await waitForRefresh(refresh.request(), waitMs);
                const response = makeAccountSet(db, url.searchParams, publicUrl);
                if (refreshed.status === 'failed') {
                    response.errors.push('FinTS refresh failed. Cached banking data was returned.');
                } else if (refreshed.status === 'updating') {
                    response.errors.push('FinTS refresh is still running. Cached banking data was returned; sync again after TAN approval.');
                }

                if (!response.accounts.length) {
                    response.errors.push('No cached bank accounts available yet. Check FinTS credentials and TAN approval.');
                }
                return reply(res, 200, JSON.stringify(response), 'application/json; charset=utf-8');
            }
            reply(res, 404, 'Not found');
        } catch (error) {
            if (error instanceof RangeError) {
                return reply(res, 400, error.message);
            }

            log.error('SimpleFIN request failed:', error);
            reply(res, 500, 'Internal server error');
        }
    });
}
