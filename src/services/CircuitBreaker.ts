export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
    failureThreshold: number;
    openDurationMs: number;
}

/**
 * One instance is constructed per LLMReviewer instance (see below) — never
 * a module-level singleton. State is isolated per dependency graph, which
 * also means tests get fresh, uncontaminated circuit state per test case.
 */
export class CircuitBreaker {
    private state: CircuitState = 'closed';
    private consecutiveFailures = 0;
    private openedAt: number | null = null;

    constructor(private readonly options: CircuitBreakerOptions) { }

    async execute<T>(fn: () => Promise<T>, fallback: () => T): Promise<T> {
        if (this.state === 'open') {
            const elapsed = Date.now() - (this.openedAt ?? 0);
            if (elapsed < this.options.openDurationMs) {
                return fallback();
            }
            this.state = 'half-open';
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch {
            this.onFailure();
            return fallback();
        }
    }

    private onSuccess(): void {
        this.consecutiveFailures = 0;
        this.state = 'closed';
        this.openedAt = null;
    }

    private onFailure(): void {
        this.consecutiveFailures += 1;
        if (this.state === 'half-open' || this.consecutiveFailures >= this.options.failureThreshold) {
            this.state = 'open';
            this.openedAt = Date.now();
        }
    }

    getState(): CircuitState {
        return this.state;
    }
}