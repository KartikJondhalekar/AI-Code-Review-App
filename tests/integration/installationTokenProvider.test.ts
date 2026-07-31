jest.setTimeout(120_000);

// octokit's auth-app ships as pure ESM and is only pulled in transitively
// here — this test overrides refreshToken and never makes a real GitHub
// call. Mocking the module keeps its ESM build out of the CommonJS test
// runtime. Redis single-flight behavior is the actual system under test.
jest.mock('@octokit/auth-app', () => ({
    createAppAuth: () => async () => ({
        token: 'stub-token',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }),
}));

import { GenericContainer, StartedTestContainer } from 'testcontainers';
import Redis from 'ioredis';
import { InstallationTokenProvider } from '../../src/services/InstallationTokenProvider';

/**
 * We can't hit real GitHub, so we subclass to stub the refresh call and
 * count how many times it actually fires. The single-flight guarantee is:
 * N concurrent getToken() calls for the same installation trigger exactly
 * ONE upstream refresh.
 */
class CountingTokenProvider extends InstallationTokenProvider {
    public refreshCount = 0;
    protected async refreshToken(installationId: number) {
        this.refreshCount += 1;
        await new Promise((r) => setTimeout(r, 150)); // simulate GitHub latency
        return { token: `tok-${installationId}-${this.refreshCount}`, expiresAt: new Date(Date.now() + 3_600_000) };
    }
}

describe('InstallationTokenProvider single-flight (real Redis)', () => {
    let container: StartedTestContainer;
    let redis: Redis;

    beforeAll(async () => {
        container = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
        redis = new Redis({ host: container.getHost(), port: container.getMappedPort(6379) });
    });

    afterAll(async () => {
        redis.disconnect();
        await container.stop();
    });

    afterEach(async () => {
        await redis.flushall();
    });

    it('collapses concurrent refreshes for the same installation into one', async () => {
        const provider = new CountingTokenProvider(redis, 'app-id', 'key', 5_000);
        const results = await Promise.all(
            Array.from({ length: 8 }, () => provider.getToken(999))
        );

        expect(provider.refreshCount).toBe(1);
        const uniqueTokens = new Set(results.map((r) => r.token));
        expect(uniqueTokens.size).toBe(1); // all callers got the same token
    });

    it('serves a cached token without a second refresh', async () => {
        const provider = new CountingTokenProvider(redis, 'app-id', 'key', 5_000);
        await provider.getToken(1);
        await provider.getToken(1);
        expect(provider.refreshCount).toBe(1);
    });
});