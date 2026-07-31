import { describe, it, expect } from '@jest/globals';
import { parseWebhookPayload, MalformedPayloadError } from '../../src/http/webhookPayload';

const validPrBody = (action: string): Buffer =>
    Buffer.from(
        JSON.stringify({
            action,
            installation: { id: 42 },
            repository: { full_name: 'acme/widgets' },
            pull_request: { number: 7, head: { sha: 'sha-7' } },
        })
    );

describe('parseWebhookPayload', () => {
    describe('events that yield a typed payload', () => {
        const cases = ['opened', 'synchronize', 'reopened'] as const;
        it.each(cases)('parses reviewable action "%s"', (action) => {
            const result = parseWebhookPayload(validPrBody(action), 'pull_request', 'del-1');
            expect(result).not.toBeNull();
            expect(result).toMatchObject({
                action,
                installationId: 42,
                repoFullName: 'acme/widgets',
                prNumber: 7,
                headSha: 'sha-7',
                deliveryId: 'del-1',
            });
        });
    });

    describe('events intentionally ignored (null, not error)', () => {
        const cases: Array<[string, string, Buffer]> = [
            ['ping event', 'ping', Buffer.from(JSON.stringify({ zen: 'x' }))],
            ['non-reviewable PR action closed', 'pull_request', validPrBody('closed')],
            ['non-reviewable PR action labeled', 'pull_request', validPrBody('labeled')],
            ['unrelated event type', 'issues', validPrBody('opened')],
        ];
        it.each(cases)('%s -> null', (_label, eventType, body) => {
            expect(parseWebhookPayload(body, eventType, 'd')).toBeNull();
        });
    });

    describe('genuinely malformed bodies (throw)', () => {
        it('throws on invalid JSON', () => {
            expect(() => parseWebhookPayload(Buffer.from('{not json'), 'pull_request', 'd')).toThrow(
                MalformedPayloadError
            );
        });

        it('throws on schema-invalid JSON (missing installation)', () => {
            const bad = Buffer.from(
                JSON.stringify({ action: 'opened', repository: { full_name: 'a/b' }, pull_request: { number: 1, head: { sha: 's' } } })
            );
            expect(() => parseWebhookPayload(bad, 'pull_request', 'd')).toThrow(MalformedPayloadError);
        });
    });

    it('defaults deliveryId to "unknown" when header absent', () => {
        const result = parseWebhookPayload(validPrBody('opened'), 'pull_request', undefined);
        expect(result?.deliveryId).toBe('unknown');
    });
});