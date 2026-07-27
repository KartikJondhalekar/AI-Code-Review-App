import { PrismaClient } from '@prisma/client';
import { IReviewHistoryStore } from '../interfaces/IReviewHistoryStore';

export class ReviewHistoryStore implements IReviewHistoryStore {
    constructor(private readonly prisma: PrismaClient) { }

    async record(params: {
        repoFullName: string;
        prNumber: number;
        headSha: string;
        summary: string;
        findingsJson: string;
    }): Promise<void> {
        await this.prisma.reviewHistory.create({ data: params });
    }
}