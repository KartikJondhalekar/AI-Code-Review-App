import Redis from 'ioredis';
import { createAppAuth } from '@octokit/auth-app';
import { IInstallationTokenProvider } from '../interfaces/IInstallationTokenProvider';
import { InstallationToken } from '../types/github.types';

const TOKEN_CACHE_PREFIX = 'gh:installation-token:';
const REFRESH_LOCK_PREFIX = 'gh:installation-token-lock:';
const EXPIRY_SAFETY_MARGIN_MS = 60_000;
const LOCK_POLL_INTERVAL_MS = 100;

export class InstallationTokenProvider implements IInstallationTokenProvider {
    private readonly auth: ReturnType<typeof createAppAuth>;

    constructor(
        private readonly redis: Redis,
        appId: string,
        privateKey: string,
        private readonly lockTtlMs: number
    ) {
        this.auth = createAppAuth({ appId, privateKey });
    }

    async getToken(installationId: number): Promise<InstallationToken> {
        const cacheKey = `${TOKEN_CACHE_PREFIX}${installationId}`;
        const cached = await this.readCached(cacheKey);
        if (cached) return cached;

        const lockKey = `${REFRESH_LOCK_PREFIX}${installationId}`;
        const acquiredLock = await this.redis.set(lockKey, '1', 'PX', this.lockTtlMs, 'NX');

        if (acquiredLock === 'OK') {
            try {
                const token = await this.refreshToken(installationId);
                await this.writeCached(cacheKey, token);
                return token;
            } finally {
                await this.redis.del(lockKey);
            }
        }

        // Someone else holds the refresh lock — poll for their result rather
        // than issuing a redundant GitHub App token request.
        const deadline = Date.now() + this.lockTtlMs;
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
            const result = await this.readCached(cacheKey);
            if (result) return result;
        }

        // Lock holder never published (crashed mid-refresh) — recover rather
        // than fail the caller outright.
        const token = await this.refreshToken(installationId);
        await this.writeCached(cacheKey, token);
        return token;
    }

    private async refreshToken(installationId: number): Promise<InstallationToken> {
        const result = await this.auth({ type: 'installation', installationId });
        return { token: result.token, expiresAt: new Date(result.expiresAt) };
    }

    private async readCached(cacheKey: string): Promise<InstallationToken | null> {
        const raw = await this.redis.get(cacheKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { token: string; expiresAt: string };
        const expiresAt = new Date(parsed.expiresAt);
        if (expiresAt.getTime() - EXPIRY_SAFETY_MARGIN_MS <= Date.now()) return null;
        return { token: parsed.token, expiresAt };
    }

    private async writeCached(cacheKey: string, token: InstallationToken): Promise<void> {
        const ttlSeconds = Math.max(1, Math.floor((token.expiresAt.getTime() - Date.now()) / 1000));
        await this.redis.set(cacheKey, JSON.stringify(token), 'EX', ttlSeconds);
    }
}