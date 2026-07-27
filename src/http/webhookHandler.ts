import { Request, Response } from 'express';
import { ReviewOrchestrator } from '../orchestration/ReviewOrchestrator';
import { Logger } from '../observability/Logger';
import { parseWebhookPayload, MalformedPayloadError } from './webhookPayload';

/**
 * The delivery contract with GitHub:
 *   400 — signature valid but payload unparseable/invalid
 *   204 — accepted event we intentionally ignore (ping, closed PRs, etc.)
 *   202 — accepted for review; pipeline runs in a detached background task
 *
 * The 202-then-detach is mandatory: DebounceGate.acquire() blocks for
 * debounceWindowMs, far longer than GitHub's webhook ACK tolerance, so the
 * pipeline must not run inline in the request/response cycle.
 */
export function createWebhookHandler(orchestrator: ReviewOrchestrator, logger: Logger) {
    return (req: Request, res: Response): void => {
        const traceId = res.locals.traceId as string;
        const eventType = req.header('x-github-event');
        const deliveryId = req.header('x-github-delivery');

        let payload;
        try {
            payload = parseWebhookPayload(req.body as Buffer, eventType, deliveryId);
        } catch (err) {
            if (err instanceof MalformedPayloadError) {
                logger.warn('webhook payload rejected', { traceId, deliveryId, detail: err.message });
                res.status(400).json({ error: err.message });
                return;
            }
            throw err;
        }

        if (payload === null) {
            logger.info('webhook event ignored', { traceId, deliveryId, eventType });
            res.status(204).send();
            return;
        }

        // ACK to GitHub immediately, then process out of band.
        res.status(202).json({ status: 'accepted', traceId });

        orchestrator.processReviewRequest(payload, traceId).catch((err) => {
            logger.error('background review pipeline threw', {
                traceId,
                deliveryId,
                error: String(err),
            });
        });
    };
}