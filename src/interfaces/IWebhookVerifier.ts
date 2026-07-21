/**
 * Verifies that an inbound webhook payload genuinely originated from GitHub
 * via HMAC-SHA256 signature comparison against the configured webhook secret.
 */
export interface IWebhookVerifier {
    verify(rawBody: Buffer, signatureHeader: string | undefined): boolean;
}