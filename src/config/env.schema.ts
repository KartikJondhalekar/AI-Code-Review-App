import { z } from 'zod';

/**
 * Single source of truth for the shape and constraints of every environment
 * variable this service depends on. No code outside this file may read
 * process.env directly — that rule is enforced by config.ts being the only
 * consumer of `process.env` in the entire codebase.
 */
export const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    // GitHub App credentials
    GITHUB_APP_ID: z.string().min(1, 'GITHUB_APP_ID is required'),
    GITHUB_PRIVATE_KEY: z
        .string()
        .min(1, 'GITHUB_PRIVATE_KEY is required')
        .refine((val) => val.includes('BEGIN RSA PRIVATE KEY') || val.includes('BEGIN PRIVATE KEY'), {
            message: 'GITHUB_PRIVATE_KEY does not look like a PEM-formatted key',
        }),
    GITHUB_WEBHOOK_SECRET: z.string().min(16, 'GITHUB_WEBHOOK_SECRET must be at least 16 characters'),

    // OpenAI
    OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
    OPENAI_MODEL: z.string().default('gpt-4o'),

    // Database
    DATABASE_URL: z
        .string()
        .url('DATABASE_URL must be a valid connection string')
        .refine((val) => val.startsWith('postgresql://') || val.startsWith('postgres://'), {
            message: 'DATABASE_URL must be a PostgreSQL connection string',
        }),

    // Redis (debounce gate + token cache)
    REDIS_URL: z.string().url('REDIS_URL must be a valid connection string'),

    // Review behavior tuning — explicitly named, no magic numbers in code
    CHUNK_THRESHOLD_LINES: z.coerce.number().int().positive().default(150),
    MAX_CONCURRENT_CHUNK_CALLS: z.coerce.number().int().min(1).max(20).default(5),
    DEBOUNCE_WINDOW_MS: z.coerce.number().int().positive().default(5000),
    INSTALLATION_TOKEN_REFRESH_LOCK_TTL_MS: z.coerce.number().int().positive().default(10000),
    LLM_CALL_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
});

export type EnvShape = z.infer<typeof envSchema>;