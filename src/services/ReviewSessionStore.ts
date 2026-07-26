import { PrismaClient } from '@prisma/client';
import { IReviewSessionStore } from '../interfaces/IReviewSessionStore';
import { ChunkStatus } from '../types/review.types';

export class ReviewSessionStore implements IReviewSessionStore {
    constructor(private readonly prisma: PrismaClient) { }

    async createSession(params: {
        repoFullName: string;
        prNumber: number;
        expectedChunkCount: number;
    }): Promise<string> {
        const session = await this.prisma.reviewSession.create({
            data: {
                repoFullName: params.repoFullName,
                prNumber: params.prNumber,
                expectedChunkCount: params.expectedChunkCount,
            },
        });
        return session.id;
    }

    async recordChunkResult(params: {
        sessionId: string;
        filePath: string;
        status: ChunkStatus;
        findingsJson: string | null;
    }): Promise<void> {
        await this.prisma.reviewSessionChunk.upsert({
            where: { sessionId_filePath: { sessionId: params.sessionId, filePath: params.filePath } },
            create: {
                sessionId: params.sessionId,
                filePath: params.filePath,
                status: params.status,
                findingsJson: params.findingsJson,
            },
            update: { status: params.status, findingsJson: params.findingsJson },
        });
    }

    async isSessionComplete(sessionId: string): Promise<boolean> {
        const session = await this.prisma.reviewSession.findUniqueOrThrow({ where: { id: sessionId } });
        const completedCount = await this.prisma.reviewSessionChunk.count({
            where: { sessionId, status: { in: ['done', 'failed'] } },
        });
        // Querying committed rows, not an in-memory tally — safe across
        // multiple process instances and survives a crash mid-fan-out
        // (Phase 1, concurrency hazard 2).
        return completedCount >= session.expectedChunkCount;
    }

    async getCompletedFindings(sessionId: string): Promise<string[]> {
        const chunks = await this.prisma.reviewSessionChunk.findMany({
            where: { sessionId, status: 'done', findingsJson: { not: null } },
        });
        return chunks.map((c) => c.findingsJson as string);
    }
}