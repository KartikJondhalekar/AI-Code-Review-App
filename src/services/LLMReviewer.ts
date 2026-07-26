import OpenAI from 'openai';
import { ILLMReviewer } from '../interfaces/ILLMReviewer';
import { DiffFile } from '../types/github.types';
import { ReviewResult, Finding, Severity } from '../types/review.types';
import { CircuitBreaker } from './CircuitBreaker';

const REVIEW_JSON_SCHEMA = {
    name: 'code_review_result',
    schema: {
        type: 'object',
        properties: {
            summary: { type: 'string' },
            findings: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        file: { type: 'string' },
                        line: { type: 'number' },
                        severity: { type: 'string', enum: ['high', 'medium', 'low'] },
                        issue: { type: 'string' },
                        suggestion: { type: 'string' },
                    },
                    required: ['file', 'line', 'severity', 'issue', 'suggestion'],
                    additionalProperties: false,
                },
            },
        },
        required: ['summary', 'findings'],
        additionalProperties: false,
    },
    strict: true,
} as const;

export class LLMReviewer implements ILLMReviewer {
    private readonly client: OpenAI;
    private readonly circuitBreaker: CircuitBreaker;

    constructor(apiKey: string, private readonly model: string, private readonly callTimeoutMs: number) {
        this.client = new OpenAI({ apiKey });
        this.circuitBreaker = new CircuitBreaker({ failureThreshold: 3, openDurationMs: 30_000 });
    }

    async reviewFull(files: readonly DiffFile[]): Promise<ReviewResult> {
        return this.executeReview(this.buildFullDiffPrompt(files));
    }

    async reviewChunk(file: DiffFile): Promise<ReviewResult> {
        return this.executeReview(this.buildChunkPrompt(file));
    }

    private async executeReview(prompt: string): Promise<ReviewResult> {
        return this.circuitBreaker.execute(
            () => this.callOpenAi(prompt),
            () => this.degradedFallback()
        );
    }

    private async callOpenAi(prompt: string): Promise<ReviewResult> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.callTimeoutMs);

        try {
            const response = await this.client.chat.completions.create(
                {
                    model: this.model,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a senior code reviewer. Respond only with the structured JSON schema provided.',
                        },
                        { role: 'user', content: prompt },
                    ],
                    response_format: { type: 'json_schema', json_schema: REVIEW_JSON_SCHEMA },
                },
                { signal: controller.signal }
            );

            const content = response.choices[0]?.message?.content;
            if (!content) throw new Error('OpenAI response contained no content');

            const parsed = JSON.parse(content) as { summary: string; findings: Finding[] };
            return {
                summary: parsed.summary,
                findings: parsed.findings.map((f) => ({
                    file: f.file,
                    line: f.line,
                    severity: f.severity as Severity,
                    issue: f.issue,
                    suggestion: f.suggestion,
                })),
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Graceful degradation path (Phase 1, Resilience & Circuit-Breaking).
     * When OpenAI is down or the circuit is open, the PR still gets a
     * response — a clearly labeled "review skipped" comment — rather than
     * the webhook handler failing silently or throwing upstream.
     */
    private degradedFallback(): ReviewResult {
        return {
            summary:
                'Automated review skipped — the review service is temporarily unavailable. Please request a manual review.',
            findings: [],
        };
    }

    private buildFullDiffPrompt(files: readonly DiffFile[]): string {
        const diffText = files.map((f) => `File: ${f.path}\n${f.patch}`).join('\n\n');
        return `Review the following pull request diff for security issues, logic problems, and style violations:\n\n${diffText}`;
    }

    private buildChunkPrompt(file: DiffFile): string {
        return `Review the following single-file diff for security issues, logic problems, and style violations:\n\nFile: ${file.path}\n${file.patch}`;
    }
}