/**
 * Persists a completed review for team-level analytics (README key
 * feature: review history). Declared here as an acknowledged Phase 2
 * omission — no existing interface changes.
 */
export interface IReviewHistoryStore {
    record(params: {
        repoFullName: string;
        prNumber: number;
        headSha: string;
        summary: string;
        findingsJson: string;
    }): Promise<void>;
}