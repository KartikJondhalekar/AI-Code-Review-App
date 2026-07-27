/**
 * Drains `items` through `worker` with at most `limit` in flight at once.
 * Used to bound parallel per-chunk LLM calls (MAX_CONCURRENT_CHUNK_CALLS)
 * so a 40-file PR does not fire 40 simultaneous OpenAI requests.
 */
export async function runWithConcurrencyLimit<T>(
    items: readonly T[],
    limit: number,
    worker: (item: T) => Promise<void>
): Promise<void> {
    const queue = [...items];

    const runNext = async (): Promise<void> => {
        const item = queue.shift();
        if (item === undefined) return;
        await worker(item);
        await runNext();
    };

    const workerCount = Math.max(1, Math.min(limit, items.length));
    const runners = Array.from({ length: workerCount }, () => runNext());
    await Promise.all(runners);
}