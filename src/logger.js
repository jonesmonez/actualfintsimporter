import winston from 'winston';

export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',

    format: winston.format.combine(
        winston.format.errors({ stack: true }),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, component, message, stack }) =>
            `${timestamp} [${level.toUpperCase()}:${component || 'main'}] ${stack || message}`
        )
    ),

    transports: [
        new winston.transports.Console()
    ]
});


export function getLogger(name) {
    const log = logger.child({ component: name });

    const barWidth = 20;
    const logInterval = 10000;
    const logStep = 5;

    let lastPercent = -1;
    let lastLoggedAt = 0;

    log.progress = (message, current, total) => {
        if (!Number.isFinite(current) ||
            !Number.isFinite(total) ||
            total <= 0) {
            log.warn('Invalid progress values');
            return;
        }

        const percent = Math.max(
            0,
            Math.min(100, Math.floor(current / total * 100))
        );

        const now = Date.now();

        if (
            percent < 100 &&
            lastPercent >= 0 &&
            percent < lastPercent + logStep &&
            now - lastLoggedAt < logInterval
        ) {
            return;
        }

        const filled = Math.round(percent / 100 * barWidth);
        const bar =
            '#'.repeat(filled) +
            '-'.repeat(barWidth - filled);

        log.info(
            `[${bar}] ${String(percent).padStart(3)}% ${message}`
        );

        lastPercent = percent;
        lastLoggedAt = now;
    };

    log.endProgress = (message) => {
        log.info(`[${'#'.repeat(barWidth)}] 100% ${message}`);

        lastPercent = -1;
        lastLoggedAt = 0;
    };

    return log;
}
