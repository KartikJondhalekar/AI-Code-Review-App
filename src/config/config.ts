import { envSchema, EnvShape } from './env.schema';

/**
 * The fully-typed, immutable application configuration.
 * This is the ONLY object downstream code should depend on for configuration —
 * never process.env directly.
 */
export interface AppConfig {
    readonly nodeEnv: EnvShape['NODE_ENV'];
    readonly port: number;
    readonly github: {
        readonly appId: string;
        readonly privateKey: string;
        readonly webhookSecret: string;
    };
    readonly openai: {
        readonly apiKey: string;
        readonly model: string;
        readonly callTimeoutMs: number;
    };
    readonly databaseUrl: string;
    readonly redisUrl: string;
    readonly review: {
        readonly chunkThresholdLines: number;
        readonly maxConcurrentChunkCalls: number;
        readonly debounceWindowMs: number;
        readonly tokenRefreshLockTtlMs: number;
    };
}

export class ConfigValidationError extends Error {
    constructor(issues: string[]) {
        super(`Application configuration is invalid:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
        this.name = 'ConfigValidationError';
    }
}

/**
 * Parses process.env against the strict schema and builds an immutable
 * AppConfig. Throws a descriptive ConfigValidationError (not a generic
 * exception) on any violation, so a misconfigured deployment fails loudly
 * at startup instead of surfacing as a runtime null-reference three layers deep.
 */
export function loadConfig(rawEnv: NodeJS.ProcessEnv = process.env): AppConfig {
    const result = envSchema.safeParse(rawEnv);

    if (!result.success) {
        const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
        throw new ConfigValidationError(issues);
    }

    const env = result.data;

    const config: AppConfig = {
        nodeEnv: env.NODE_ENV,
        port: env.PORT,
        github: {
            appId: env.GITHUB_APP_ID,
            privateKey: env.GITHUB_PRIVATE_KEY,
            webhookSecret: env.GITHUB_WEBHOOK_SECRET,
        },
        openai: {
            apiKey: env.OPENAI_API_KEY,
            model: env.OPENAI_MODEL,
            callTimeoutMs: env.LLM_CALL_TIMEOUT_MS,
        },
        databaseUrl: env.DATABASE_URL,
        redisUrl: env.REDIS_URL,
        review: {
            chunkThresholdLines: env.CHUNK_THRESHOLD_LINES,
            maxConcurrentChunkCalls: env.MAX_CONCURRENT_CHUNK_CALLS,
            debounceWindowMs: env.DEBOUNCE_WINDOW_MS,
            tokenRefreshLockTtlMs: env.INSTALLATION_TOKEN_REFRESH_LOCK_TTL_MS,
        },
    };

    return Object.freeze(config);
}