import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { IWebhookVerifier } from '../interfaces/IWebhookVerifier';
import { Logger } from '../observability/Logger';

/**
 * Assigns a correlation id to every request and echoes it as the
 * x-trace-id response header (Phase 4, compliance/protocol headers).
 */
export function createTraceMiddleware() {
    return (_req: Request, res: Response, next: NextFunction): void => {
        const traceId = randomUUID();
        res.locals.traceId = traceId;
        res.setHeader('x-trace-id', traceId);
        next();
    };
}

/**
 * Verifies the GitHub HMAC-SHA256 signature over the RAW request body.
 * Requires express.raw() to have populated req.body as a Buffer upstream.
 */
export function createSignatureVerificationMiddleware(verifier: IWebhookVerifier, logger: Logger) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const traceId = res.locals.traceId as string;
        const signature = req.header('x-hub-signature-256');
        const rawBody = req.body;

        if (!Buffer.isBuffer(rawBody)) {
            logger.error('raw body missing on webhook route', { traceId });
            res.status(500).json({ error: 'internal misconfiguration' });
            return;
        }

        if (!verifier.verify(rawBody, signature)) {
            logger.warn('webhook rejected: invalid signature', { traceId });
            res.status(401).json({ error: 'invalid signature' });
            return;
        }

        next();
    };
}