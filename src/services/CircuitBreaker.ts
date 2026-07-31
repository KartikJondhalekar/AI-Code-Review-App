export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
    failureThreshold: number;
    openDurationMs: number;
    onStateChange?: (state: CircuitState) => void;
}

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
            this.transitionTo('half-open');
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
        this.transitionTo('closed');
        this.openedAt = null;
    }

    private onFailure(): void {
        this.consecutiveFailures += 1;
        if (this.state === 'half-open' || this.consecutiveFailures >= this.options.failureThreshold) {
            this.openedAt = Date.now();
            this.transitionTo('open');
        }
    }

    private transitionTo(state: CircuitState): void {
        if (this.state !== state) {
            this.state = state;
            this.options.onStateChange?.(state);
        }
    }

    getState(): CircuitState {
        return this.state;
    }
}