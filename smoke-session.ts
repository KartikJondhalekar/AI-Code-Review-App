import { PrismaClient } from '@prisma/client';
import { ReviewSessionStore } from './src/services/ReviewSessionStore';
import process from 'process';

async function main(): Promise<void> {
    const prisma = new PrismaClient();
    const store = new ReviewSessionStore(prisma);

    const sessionId = await store.createSession({
        repoFullName: 'test/repo',
        prNumber: 1,
        expectedChunkCount: 3,
    });
    console.log('Session created:', sessionId);
    console.log('Complete before chunks recorded:', await store.isSessionComplete(sessionId));

    await store.recordChunkResult({ sessionId, filePath: 'a.ts', status: 'done', findingsJson: '[]' });
    await store.recordChunkResult({ sessionId, filePath: 'b.ts', status: 'done', findingsJson: '[]' });
    await store.recordChunkResult({ sessionId, filePath: 'c.ts', status: 'failed', findingsJson: null });

    console.log('Complete after all chunks recorded:', await store.isSessionComplete(sessionId));

    await prisma.$disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});