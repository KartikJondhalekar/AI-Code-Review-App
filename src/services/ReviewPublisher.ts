import { Octokit } from '@octokit/rest';
import { IReviewPublisher } from '../interfaces/IReviewPublisher';
import { IInstallationTokenProvider } from '../interfaces/IInstallationTokenProvider';
import { ReviewResult } from '../types/review.types';

export class ReviewPublisher implements IReviewPublisher {
    constructor(private readonly tokenProvider: IInstallationTokenProvider) { }

    async publish(params: {
        installationId: number;
        repoFullName: string;
        prNumber: number;
        headSha: string;
        result: ReviewResult;
    }): Promise<void> {
        const { token } = await this.tokenProvider.getToken(params.installationId);
        const octokit = new Octokit({ auth: token });
        const [owner, repo] = params.repoFullName.split('/');

        const comments = params.result.findings.map((f) => ({
            path: f.file,
            line: f.line,
            body: `**[${f.severity.toUpperCase()}]** ${f.issue}\n\n**Suggestion:** ${f.suggestion}`,
        }));

        await octokit.rest.pulls.createReview({
            owner,
            repo,
            pull_number: params.prNumber,
            commit_id: params.headSha,
            event: 'COMMENT',
            body: params.result.summary,
            comments,
        });
    }
}