import { AppConfig } from '../config/config';
import { Logger } from '../observability/Logger';
import { IGitHubDiffFetcher } from '../interfaces/IGitHubDiffFetcher';
import { IDiffRouter } from '../interfaces/IDiffRouter';
import { ILLMReviewer } from '../interfaces/ILLMReviewer';
import { IReviewSessionStore } from '../interfaces/IReviewSessionStore';
import { IReviewHistoryStore } from '../interfaces/IReviewHistoryStore';
import { IDebounceGate } from '../interfaces/IDebounceGate';
import { IReviewPublisher } from '../interfaces/IReviewPublisher';
import { PullRequestWebhookPayload, DiffFile } from '../types/github.types';
import { Finding, ReviewResult } from '../types/review.types';
import { runWithConcurrencyLimit } from '../utils/concurrency';

export interface ReviewOrchestratorDeps {
    readonly config: AppConfig;
    readonly logger: Logger;
    readonly diffFetcher: IGitHubDiffFetcher;
    readonly diffRouter: IDiffRouter;
    readonly llmReviewer: ILLMReviewer;
    readonly sessionStore: IReviewSessionStore;
    readonly historyStore: IReviewHistoryStore;
    readonly debounceGate: IDebounceGate;
    readonly reviewPublisher: IReviewPublisher;
}

export class ReviewOrchestrator {
    constructor(private readonly deps: ReviewOrchestratorDeps) { }

    /**
     * Full pipeline for one PR event. Runs OUTSIDE the HTTP request cycle —
     * the webhook route ACKs 202 first, then invokes this without awaiting.
     * Every early-return is a deliberate, logged terminal state, never a
     * silent drop.
     */
    async processReviewRequest(payload: PullRequestWebhookPayload, traceId: string): Promise<void> {
        // Receipt timestamp doubles as the monotonically increasing sequence id
        // for the debounce/supersede gate (Phase 1, concurrency hazard 1).
        const sequenceId = Date.now();
        const log = this.deps.logger.child({
            traceId,
            deliveryId: payload.deliveryId,
            repo: payload.repoFullName,
            pr: payload.prNumber,
            sequenceId,
        });

        log.info('review pipeline started', { action: payload.action });

        // 1. Debounce/supersede gate — blocks debounceWindowMs, then reports
        //    whether this event is still the newest for the PR.
        const isCurrent = await this.deps.debounceGate.acquire({
            repoFullName: payload.repoFullName,
            prNumber: payload.prNumber,
            sequenceId,
        });
        if (!isCurrent) {
            log.info('superseded during debounce window, skipping');
            return;
        }

        // 2. Fetch the diff.
        const files = await this.deps.diffFetcher.fetchDiff({
            installationId: payload.installationId,
            repoFullName: payload.repoFullName,
            prNumber: payload.prNumber,
        });
        if (files.length === 0) {
            log.info('no reviewable files in diff, skipping');
            return;
        }

        // 3. Route to a strategy and produce a review.
        const strategy = this.deps.diffRouter.decideStrategy(files);
        log.info('strategy selected', { strategy, fileCount: files.length });

        const result =
            strategy === 'single-pass'
                ? await this.deps.llmReviewer.reviewFull(files)
                : await this.runChunkedReview(files, payload, log);

        // 4. Supersede re-check before publishing — a newer push may have
        //    arrived while the LLM calls were in flight. Discard stale reviews.
        const stillCurrent = await this.deps.debounceGate.isCurrent({
            repoFullName: payload.repoFullName,
            prNumber: payload.prNumber,
            sequenceId,
        });
        if (!stillCurrent) {
            log.info('superseded after review completed, discarding result');
            return;
        }

        // 5. Publish to GitHub and persist history.
        await this.deps.reviewPublisher.publish({
            installationId: payload.installationId,
            repoFullName: payload.repoFullName,
            prNumber: payload.prNumber,
            headSha: payload.headSha,
            result,
        });
        await this.deps.historyStore.record({
            repoFullName: payload.repoFullName,
            prNumber: payload.prNumber,
            headSha: payload.headSha,
            summary: result.summary,
            findingsJson: JSON.stringify(result.findings),
        });

        log.info('review published', { findingCount: result.findings.length });
    }

    private async runChunkedReview(
        files: readonly DiffFile[],
        payload: PullRequestWebhookPayload,
        log: Logger
    ): Promise<ReviewResult> {
        const sessionId = await this.deps.sessionStore.createSession({
            repoFullName: payload.repoFullName,
            prNumber: payload.prNumber,
            expectedChunkCount: files.length,
        });

        await runWithConcurrencyLimit(files, this.deps.config.review.maxConcurrentChunkCalls, async (file) => {
            try {
                const chunkResult = await this.deps.llmReviewer.reviewChunk(file);
                await this.deps.sessionStore.recordChunkResult({
                    sessionId,
                    filePath: file.path,
                    status: 'done',
                    findingsJson: JSON.stringify(chunkResult.findings),
                });
            } catch (err) {
                log.error('chunk review failed', { file: file.path, error: String(err) });
                await this.deps.sessionStore.recordChunkResult({
                    sessionId,
                    filePath: file.path,
                    status: 'failed',
                    findingsJson: null,
                });
            }
        });

        // Fan-in complete — merge findings from durably-recorded chunk results.
        const findingsJsonList = await this.deps.sessionStore.getCompletedFindings(sessionId);
        const mergedFindings: Finding[] = findingsJsonList.flatMap(
            (json) => JSON.parse(json) as Finding[]
        );

        const complete = await this.deps.sessionStore.isSessionComplete(sessionId);
        const summary = complete
            ? `Chunked review across ${files.length} files: ${mergedFindings.length} findings.`
            : `Partial review — some file chunks failed. ${mergedFindings.length} findings from successful chunks.`;

        return { summary, findings: mergedFindings };
    }
}