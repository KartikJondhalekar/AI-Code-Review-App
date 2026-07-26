import { IDiffRouter } from '../interfaces/IDiffRouter';
import { DiffFile } from '../types/github.types';
import { ReviewStrategy } from '../types/review.types';

export class DiffRouter implements IDiffRouter {
    constructor(private readonly chunkThresholdLines: number) { }

    decideStrategy(files: readonly DiffFile[]): ReviewStrategy {
        const totalChangedLines = files.reduce((sum, f) => sum + f.changedLines, 0);
        return totalChangedLines >= this.chunkThresholdLines ? 'chunked' : 'single-pass';
    }
}