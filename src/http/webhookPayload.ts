import { z } from 'zod';
import { PullRequestWebhookPayload } from '../types/github.types';

const REVIEWABLE_ACTIONS = ['opened', 'synchronize', 'reopened'] as const;

const pullRequestEventSchema = z.object({
    action: z.string(),
    installation: z.object({ id: z.number() }),
    repository: z.object({ full_name: z.string() }),
    pull_request: z.object({
        number: z.number(),
        head: z.object({ sha: z.string() }),
    }),
});

export class MalformedPayloadError extends Error {
    constructor(detail: string) {
        super(`Malformed webhook payload: ${detail}`);
        this.name = 'MalformedPayloadError';
    }
}

/**
 * Returns a typed payload for reviewable PR events, or null for events we
 * intentionally ignore (ping, non-PR events, non-reviewable PR actions
 * like 'closed' or 'labeled'). Throws MalformedPayloadError only when the
 * body is genuinely unparseable/invalid — that distinction drives the
 * 204-vs-400 response mapping in the handler.
 */
export function parseWebhookPayload(
    rawBody: Buffer,
    eventType: string | undefined,
    deliveryId: string | undefined
): PullRequestWebhookPayload | null {
    if (eventType !== 'pull_request') return null;

    let json: unknown;
    try {
        json = JSON.parse(rawBody.toString('utf8'));
    } catch {
        throw new MalformedPayloadError('body is not valid JSON');
    }

    const parsed = pullRequestEventSchema.safeParse(json);
    if (!parsed.success) {
        throw new MalformedPayloadError(parsed.error.issues.map((i) => i.path.join('.')).join(', '));
    }

    if (!REVIEWABLE_ACTIONS.includes(parsed.data.action as (typeof REVIEWABLE_ACTIONS)[number])) {
        return null;
    }

    return {
        action: parsed.data.action,
        installationId: parsed.data.installation.id,
        repoFullName: parsed.data.repository.full_name,
        prNumber: parsed.data.pull_request.number,
        headSha: parsed.data.pull_request.head.sha,
        deliveryId: deliveryId ?? 'unknown',
    };
}