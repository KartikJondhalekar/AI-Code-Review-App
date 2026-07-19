export type Severity = 'high' | 'medium' | 'low';

export interface Finding {
    readonly file: string;
    readonly line: number;
    readonly severity: Severity;
    readonly issue: string;
    readonly suggestion: string;
}

export interface ReviewResult {
    readonly summary: string;
    readonly findings: readonly Finding[];
}

export type ReviewStrategy = 'single-pass' | 'chunked';

export interface DiffChunk {
    readonly sessionId: string;
    readonly filePath: string;
    readonly patch: string;
}

export type ChunkStatus = 'pending' | 'done' | 'failed' | 'superseded';