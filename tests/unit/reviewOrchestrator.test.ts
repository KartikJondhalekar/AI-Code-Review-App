import { ReviewOrchestrator, ReviewOrchestratorDeps } from '../../src/orchestration/ReviewOrchestrator';
import { DiffFile } from '../../src/types/github.types';
import { ReviewResult } from '../../src/types/review.types';
import { Metrics } from '../../src/observability/Metrics';

const silentLogger = () => {
    const l: any = {};
    l.child = () => l;
    l.debug = jest.fn();
    l.info = jest.fn();
    l.warn = jest.fn();
    l.error = jest.fn();
    return l;
};

const file = (path: string, lines: number): DiffFile => ({
    path,
    patch: `@@ ${path} @@`,
    additions: lines,
    deletions: 0,
    changedLines: lines,
});

const emptyResult: ReviewResult = { summary: 'ok', findings: [] };

function buildDeps(overrides: Partial<ReviewOrchestratorDeps> = {}): {
    deps: ReviewOrchestratorDeps;
    mocks: Record<string, jest.Mock>;
} {
    const mocks = {
        acquire: jest.fn().mockResolvedValue(true),
        isCurrent: jest.fn().mockResolvedValue(true),
        fetchDiff: jest.fn().mockResolvedValue([file('a.ts', 10)]),
        decideStrategy: jest.fn().mockReturnValue('single-pass'),
        reviewFull: jest.fn().mockResolvedValue(emptyResult),
        reviewChunk: jest.fn().mockResolvedValue(emptyResult),
        createSession: jest.fn().mockResolvedValue('session-1'),
        recordChunkResult: jest.fn().mockResolvedValue(undefined),
        isSessionComplete: jest.fn().mockResolvedValue(true),
        getCompletedFindings: jest.fn().mockResolvedValue([]),
        record: jest.fn().mockResolvedValue(undefined),
        publish: jest.fn().mockResolvedValue(undefined),
    };

    const deps: ReviewOrchestratorDeps = {
        config: { review: { maxConcurrentChunkCalls: 5 } } as any,
        logger: silentLogger(),
        metrics: new Metrics(),
        debounceGate: { acquire: mocks.acquire, isCurrent: mocks.isCurrent },
        diffFetcher: { fetchDiff: mocks.fetchDiff },
        diffRouter: { decideStrategy: mocks.decideStrategy },
        llmReviewer: { reviewFull: mocks.reviewFull, reviewChunk: mocks.reviewChunk },
        sessionStore: {
            createSession: mocks.createSession,
            recordChunkResult: mocks.recordChunkResult,
            isSessionComplete: mocks.isSessionComplete,
            getCompletedFindings: mocks.getCompletedFindings,
        },
        historyStore: { record: mocks.record },
        reviewPublisher: { publish: mocks.publish },
        ...overrides,
    };
    return { deps, mocks };
}

const payload = {
    action: 'opened',
    installationId: 1,
    repoFullName: 'acme/widgets',
    prNumber: 5,
    headSha: 'sha-5',
    deliveryId: 'del-5',
};

describe('ReviewOrchestrator.processReviewRequest', () => {
    it('single-pass: fetches, reviews, publishes, and records history', async () => {
        const { deps, mocks } = buildDeps();
        await new ReviewOrchestrator(deps).processReviewRequest(payload, 'trace-1');

        expect(mocks.reviewFull).toHaveBeenCalledTimes(1);
        expect(mocks.reviewChunk).not.toHaveBeenCalled();
        expect(mocks.publish).toHaveBeenCalledTimes(1);
        expect(mocks.record).toHaveBeenCalledTimes(1);
    });

    it('aborts before fetching when superseded during the debounce window', async () => {
        const { deps, mocks } = buildDeps();
        mocks.acquire.mockResolvedValue(false);

        await new ReviewOrchestrator(deps).processReviewRequest(payload, 'trace-1');

        expect(mocks.fetchDiff).not.toHaveBeenCalled();
        expect(mocks.publish).not.toHaveBeenCalled();
    });

    it('discards result when superseded AFTER review completes (never publishes stale)', async () => {
        const { deps, mocks } = buildDeps();
        mocks.acquire.mockResolvedValue(true);
        mocks.isCurrent.mockResolvedValue(false); // newer push arrived during LLM call

        await new ReviewOrchestrator(deps).processReviewRequest(payload, 'trace-1');

        expect(mocks.reviewFull).toHaveBeenCalledTimes(1);
        expect(mocks.publish).not.toHaveBeenCalled();
        expect(mocks.record).not.toHaveBeenCalled();
    });

    it('skips cleanly when the diff has no reviewable files', async () => {
        const { deps, mocks } = buildDeps();
        mocks.fetchDiff.mockResolvedValue([]);

        await new ReviewOrchestrator(deps).processReviewRequest(payload, 'trace-1');

        expect(mocks.decideStrategy).not.toHaveBeenCalled();
        expect(mocks.publish).not.toHaveBeenCalled();
    });

    it('chunked: fans out per file, records each chunk, and merges findings', async () => {
        const { deps, mocks } = buildDeps();
        mocks.fetchDiff.mockResolvedValue([file('a.ts', 100), file('b.ts', 80)]);
        mocks.decideStrategy.mockReturnValue('chunked');
        mocks.getCompletedFindings.mockResolvedValue([
            JSON.stringify([{ file: 'a.ts', line: 1, severity: 'low', issue: 'x', suggestion: 'y' }]),
        ]);

        await new ReviewOrchestrator(deps).processReviewRequest(payload, 'trace-1');

        expect(mocks.createSession).toHaveBeenCalledWith(
            expect.objectContaining({ expectedChunkCount: 2 })
        );
        expect(mocks.reviewChunk).toHaveBeenCalledTimes(2);
        expect(mocks.recordChunkResult).toHaveBeenCalledTimes(2);
        expect(mocks.publish).toHaveBeenCalledTimes(1);
    });

    it('chunked: a failed chunk is recorded as failed but does not abort the run', async () => {
        const { deps, mocks } = buildDeps();
        mocks.fetchDiff.mockResolvedValue([file('a.ts', 100), file('b.ts', 80)]);
        mocks.decideStrategy.mockReturnValue('chunked');
        mocks.reviewChunk
            .mockResolvedValueOnce(emptyResult)
            .mockRejectedValueOnce(new Error('LLM timeout'));

        await new ReviewOrchestrator(deps).processReviewRequest(payload, 'trace-1');

        const statuses = mocks.recordChunkResult.mock.calls.map((c) => c[0].status);
        expect(statuses).toContain('done');
        expect(statuses).toContain('failed');
        expect(mocks.publish).toHaveBeenCalledTimes(1); // still publishes partial review
    });
});