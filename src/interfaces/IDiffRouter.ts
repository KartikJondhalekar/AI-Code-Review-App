import { DiffFile } from '../types/github.types';
import { ReviewStrategy } from '../types/review.types';

/**
 * Decides single-pass vs. chunked review strategy based on total changed
 * line count against the configured threshold (Phase 1, Algorithmic
 * Trade-off Analysis). Pure decision logic — no I/O.
 */
export interface IDiffRouter {
    decideStrategy(files: readonly DiffFile[]): ReviewStrategy;
}