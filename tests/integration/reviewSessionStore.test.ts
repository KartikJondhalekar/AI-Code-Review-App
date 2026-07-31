import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { ReviewSessionStore } from '../../src/services/ReviewSessionStore';

jest.setTimeout(120_000);

describe('ReviewSessionStore fan-in (real Postgres)', () => {
    let container: StartedPostgreSqlContainer;
    let prisma: PrismaClient;

    beforeAll(async () => {
        container = await new PostgreSqlContainer('postgres:16-alpine').start();
        const url = container.getConnectionUri();
        execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
        prisma = new PrismaClient({ datasources: { db: { url } } });
    });

    afterAll(async () => {
        await prisma.$disconnect();
        await container.stop();
    });

    afterEach(async () => {
        await prisma.reviewSessionChunk.deleteMany();
        await prisma.reviewSession.deleteMany();
    });

    it('is incomplete until expectedChunkCount results (done or failed) are recorded', async () => {
        const store = new ReviewSessionStore(prisma);
        const id = await store.createSession({ repoFullName: 'a/b', prNumber: 1, expectedChunkCount: 3 });

        expect(await store.isSessionComplete(id)).toBe(false);
        await store.recordChunkResult({ sessionId: id, filePath: 'a.ts', status: 'done', findingsJson: '[]' });
        expect(await store.isSessionComplete(id)).toBe(false);
        await store.recordChunkResult({ sessionId: id, filePath: 'b.ts', status: 'failed', findingsJson: null });
        expect(await store.isSessionComplete(id)).toBe(false);
        await store.recordChunkResult({ sessionId: id, filePath: 'c.ts', status: 'done', findingsJson: '[]' });
        expect(await store.isSessionComplete(id)).toBe(true);
    });

    it('re-recording the same file (upsert) does not inflate the completion count', async () => {
        const store = new ReviewSessionStore(prisma);
        const id = await store.createSession({ repoFullName: 'a/b', prNumber: 2, expectedChunkCount: 2 });

        await store.recordChunkResult({ sessionId: id, filePath: 'a.ts', status: 'failed', findingsJson: null });
        await store.recordChunkResult({ sessionId: id, filePath: 'a.ts', status: 'done', findingsJson: '[]' }); // retry same file
        expect(await store.isSessionComplete(id)).toBe(false); // still only 1 distinct file done

        await store.recordChunkResult({ sessionId: id, filePath: 'b.ts', status: 'done', findingsJson: '[]' });
        expect(await store.isSessionComplete(id)).toBe(true);
    });

    it('getCompletedFindings returns only findings from done chunks', async () => {
        const store = new ReviewSessionStore(prisma);
        const id = await store.createSession({ repoFullName: 'a/b', prNumber: 3, expectedChunkCount: 2 });
        await store.recordChunkResult({
            sessionId: id, filePath: 'a.ts', status: 'done',
            findingsJson: JSON.stringify([{ file: 'a.ts', line: 1, severity: 'low', issue: 'i', suggestion: 's' }]),
        });
        await store.recordChunkResult({ sessionId: id, filePath: 'b.ts', status: 'failed', findingsJson: null });

        const findings = await store.getCompletedFindings(id);
        expect(findings).toHaveLength(1);
    });
});