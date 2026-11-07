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

    log.progress = (message) => {
        const timestamp = new Date().toLocaleString('sv-SE');
        process.stdout.write(`\r\x1b[2K${timestamp} [INFO:${name}] ${message}`);
    };

    log.endProgress = (message) => {
        const timestamp = new Date().toLocaleString('sv-SE');
        process.stdout.write(`\r\x1b[2K${timestamp} [INFO:${name}] ${message}\n`);
    };

    return log;
}
