import Redis from 'ioredis';
import { IDebounceGate } from '../interfaces/IDebounceGate';

const CURRENT_SEQUENCE_PREFIX = 'pr:current-sequence:';

export class DebounceGate implements IDebounceGate {
    constructor(private readonly redis: Redis, private readonly debounceWindowMs: number) { }

    async acquire(params: { repoFullName: string; prNumber: number; sequenceId: number }): Promise<boolean> {
        const key = this.buildKey(params.repoFullName, params.prNumber);
        // Newest event always wins — a plain SET (not NX) overwrites the
        // "current" pointer, with a generous TTL so stale keys self-clean.
        await this.redis.set(key, params.sequenceId.toString(), 'PX', this.debounceWindowMs * 4);
        await new Promise((resolve) => setTimeout(resolve, this.debounceWindowMs));
        return this.isCurrent(params);
    }

    async isCurrent(params: { repoFullName: string; prNumber: number; sequenceId: number }): Promise<boolean> {
        const key = this.buildKey(params.repoFullName, params.prNumber);
        const stored = await this.redis.get(key);
        if (!stored) return false;
        return parseInt(stored, 10) === params.sequenceId;
    }

    private buildKey(repoFullName: string, prNumber: number): string {
        return `${CURRENT_SEQUENCE_PREFIX}${repoFullName}:${prNumber}`;
    }
}