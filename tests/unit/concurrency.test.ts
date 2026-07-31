/// <reference types="jest" />

import { runWithConcurrencyLimit } from '../../src/utils/concurrency';

describe('runWithConcurrencyLimit', () => {
    it('processes every item exactly once', async () => {
        const items = Array.from({ length: 20 }, (_, i) => i);
        const seen: number[] = [];
        await runWithConcurrencyLimit(items, 5, async (n) => {
            seen.push(n);
        });
        expect(seen.sort((a, b) => a - b)).toEqual(items);
    });

    it('never exceeds the concurrency limit at any instant', async () => {
        const items = Array.from({ length: 30 }, (_, i) => i);
        let inFlight = 0;
        let maxObserved = 0;
        await runWithConcurrencyLimit(items, 4, async () => {
            inFlight += 1;
            maxObserved = Math.max(maxObserved, inFlight);
            await new Promise((r) => setTimeout(r, 5));
            inFlight -= 1;
        });
        expect(maxObserved).toBeLessThanOrEqual(4);
    });

    it('handles an empty item list without spawning workers', async () => {
        const worker = jest.fn();
        await runWithConcurrencyLimit([], 5, worker);
        expect(worker).not.toHaveBeenCalled();
    });
});