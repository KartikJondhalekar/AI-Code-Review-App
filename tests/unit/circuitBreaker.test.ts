import { CircuitBreaker } from '../../src/services/CircuitBreaker';

describe('CircuitBreaker', () => {
    it('opens after the failure threshold and falls back', async () => {
        const breaker = new CircuitBreaker({ failureThreshold: 2, openDurationMs: 1000 });
        const failing = () => Promise.reject(new Error('boom'));
        const fallback = () => 'fallback-value';

        await breaker.execute(failing, fallback);
        await breaker.execute(failing, fallback);
        expect(breaker.getState()).toBe('open');

        const result = await breaker.execute(() => Promise.resolve('should-not-run'), fallback);
        expect(result).toBe('fallback-value');
    });
});