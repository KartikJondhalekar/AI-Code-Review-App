import { ReviewResult } from '../types/review.types';

/**
 * Posts a completed ReviewResult back to GitHub as inline PR review
 * comments, using an authenticated installation token.
 */
export interface IReviewPublisher {
    publish(params: {
        installationId: number;
        repoFullName: string;
        prNumber: number;
        headSha: string;
        result: ReviewResult;
    }): Promise<void>;
}