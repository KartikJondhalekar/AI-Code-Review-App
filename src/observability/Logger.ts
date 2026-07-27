export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
    child(context: Record<string, unknown>): Logger;
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Emits one JSON object per line to stdout (warn/info/debug) or stderr
 * (error). Request-scoped context (traceId, deliveryId) is attached via
 * child() so every log line in a pipeline run is correlatable — no
 * global logger singleton, instances are threaded through constructors.
 */
export class JsonLogger implements Logger {
    constructor(private readonly baseContext: Record<string, unknown> = {}) { }

    child(context: Record<string, unknown>): Logger {
        return new JsonLogger({ ...this.baseContext, ...context });
    }

    debug(message: string, meta: Record<string, unknown> = {}): void {
        this.write('debug', message, meta);
    }
    info(message: string, meta: Record<string, unknown> = {}): void {
        this.write('info', message, meta);
    }
    warn(message: string, meta: Record<string, unknown> = {}): void {
        this.write('warn', message, meta);
    }
    error(message: string, meta: Record<string, unknown> = {}): void {
        this.write('error', message, meta);
    }

    private write(level: LogLevel, message: string, meta: Record<string, unknown>): void {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            ...this.baseContext,
            ...meta,
        };
        const line = JSON.stringify(entry) + '\n';
        if (level === 'error') {
            process.stderr.write(line);
        } else {
            process.stdout.write(line);
        }
    }
}