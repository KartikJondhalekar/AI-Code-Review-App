import { GenericContainer, StartedTestContainer } from 'testcontainers';
import Redis from 'ioredis';
import { DebounceGate } from '../../src/services/DebounceGate';

jest.setTimeout(120_000);

describe('DebounceGate (real Redis)', () => {
    let container: StartedTestContainer;
    let redis: Redis;
    const DEBOUNCE_MS = 200;

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

    it('the newest sequence supersedes an older concurrent one for the same PR', async () => {
        const gate = new DebounceGate(redis, DEBOUNCE_MS);
        const key = { repoFullName: 'a/b', prNumber: 1 };

        // Older event starts its debounce; newer event overwrites mid-window.
        const older = gate.acquire({ ...key, sequenceId: 1000 });
        await new Promise((r) => setTimeout(r, DEBOUNCE_MS / 2));
        const newer = gate.acquire({ ...key, sequenceId: 2000 });

        expect(await older).toBe(false); // superseded
        expect(await newer).toBe(true); // wins
    });

    it('a single uncontested event acquires successfully', async () => {
        const gate = new DebounceGate(redis, DEBOUNCE_MS);
        expect(await gate.acquire({ repoFullName: 'a/b', prNumber: 2, sequenceId: 1 })).toBe(true);
    });

    it('isCurrent reflects the latest sequence written for the PR', async () => {
        const gate = new DebounceGate(redis, DEBOUNCE_MS);
        const key = { repoFullName: 'a/b', prNumber: 3 };
        await gate.acquire({ ...key, sequenceId: 5 });
        await gate.acquire({ ...key, sequenceId: 6 });
        expect(await gate.isCurrent({ ...key, sequenceId: 5 })).toBe(false);
        expect(await gate.isCurrent({ ...key, sequenceId: 6 })).toBe(true);
    });
});