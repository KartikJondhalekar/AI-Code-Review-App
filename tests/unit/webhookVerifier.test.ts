import { describe, it, expect } from '@jest/globals';
import { WebhookVerifier } from '../../src/services/WebhookVerifier';
import crypto from 'crypto';

describe('WebhookVerifier', () => {
    const secret = 'test-secret';
    const verifier = new WebhookVerifier(secret);
    const body = Buffer.from(JSON.stringify({ action: 'opened' }));

    it('accepts a correctly signed payload', () => {
        const validSig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
        expect(verifier.verify(body, validSig)).toBe(true);
    });

    it('rejects a tampered signature', () => {
        expect(verifier.verify(body, 'sha256=deadbeef')).toBe(false);
    });

    it('rejects a missing signature header', () => {
        expect(verifier.verify(body, undefined)).toBe(false);
    });
});