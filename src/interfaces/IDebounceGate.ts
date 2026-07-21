/**
 * Redis-backed debounce/supersede gate keyed on (repoFullName, prNumber).
 * Returns whether the caller's request is still the most current one for
 * that PR at the moment of the check.
 */
export interface IDebounceGate {
    acquire(params: { repoFullName: string; prNumber: number; sequenceId: number }): Promise<boolean>;
    isCurrent(params: { repoFullName: string; prNumber: number; sequenceId: number }): Promise<boolean>;
}