import { DiffFile } from '../types/github.types';
import { ReviewResult } from '../types/review.types';

/**
 * Wraps the OpenAI structured-output call. reviewFull is used for the
 * single-pass strategy; reviewChunk is used per-file under the chunked
 * strategy. Both must return a schema-validated ReviewResult — never raw
 * free text.
 */
export interface ILLMReviewer {
    reviewFull(files: readonly DiffFile[]): Promise<ReviewResult>;
    reviewChunk(file: DiffFile): Promise<ReviewResult>;
}