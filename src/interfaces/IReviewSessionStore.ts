import { ChunkStatus } from '../types/review.types';

/**
 * Durable (Postgres-backed) fan-in tracking for the chunked review strategy.
 * No in-memory counters — session completion is determined by querying
 * committed rows, so it is safe across multiple process instances and
 * survives a mid-fan-out crash.
 */
export interface IReviewSessionStore {
    createSession(params: { repoFullName: string; prNumber: number; expectedChunkCount: number }): Promise<string>;
    recordChunkResult(params: { sessionId: string; filePath: string; status: ChunkStatus; findingsJson: string | null }): Promise<void>;
    isSessionComplete(sessionId: string): Promise<boolean>;
    getCompletedFindings(sessionId: string): Promise<string[]>;
}