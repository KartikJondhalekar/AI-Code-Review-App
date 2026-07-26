import { DiffRouter } from '../../src/services/DiffRouter';
import { DiffFile } from '../../src/types/github.types';

const makeFile = (changedLines: number): DiffFile => ({
    path: 'x.ts', patch: '', additions: changedLines, deletions: 0, changedLines,
});

describe('DiffRouter', () => {
    const router = new DiffRouter(150);

    it('routes small diffs to single-pass', () => {
        expect(router.decideStrategy([makeFile(50), makeFile(40)])).toBe('single-pass');
    });

    it('routes large diffs to chunked', () => {
        expect(router.decideStrategy([makeFile(100), makeFile(60)])).toBe('chunked');
    });
});