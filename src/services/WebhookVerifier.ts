import crypto from 'crypto';
import { IWebhookVerifier } from '../interfaces/IWebhookVerifier';

export class WebhookVerifier implements IWebhookVerifier {
    constructor(private readonly webhookSecret: string) { }

    verify(rawBody: Buffer, signatureHeader: string | undefined): boolean {
        if (!signatureHeader) return false;

        const expectedSignature =
            'sha256=' + crypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');

        const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
        const actualBuffer = Buffer.from(signatureHeader, 'utf8');

        // Length check before timingSafeEqual — it throws on mismatched buffer
        // lengths rather than returning false, and comparing length first leaks
        // no meaningful timing information (length isn't secret).
        if (expectedBuffer.length !== actualBuffer.length) return false;

        return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
    }
}