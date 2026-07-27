import express, { Express } from 'express';
import { AppConfig } from './config/config';
import { Logger } from './observability/Logger';
import { IWebhookVerifier } from './interfaces/IWebhookVerifier';
import { ReviewOrchestrator } from './orchestration/ReviewOrchestrator';
import { createTraceMiddleware, createSignatureVerificationMiddleware } from './http/middleware';
import { createWebhookHandler } from './http/webhookHandler';

export interface AppDependencies {
    readonly config: AppConfig;
    readonly logger: Logger;
    readonly webhookVerifier: IWebhookVerifier;
    readonly orchestrator: ReviewOrchestrator;
}

export function createApp(deps: AppDependencies): Express {
    const app = express();

    app.use(createTraceMiddleware());

    app.get('/healthz', (_req, res) => {
        res.status(200).json({ status: 'ok' });
    });

    // express.raw MUST precede signature verification so req.body is the
    // exact bytes GitHub signed. No global JSON parser is registered, so it
    // cannot accidentally consume/re-encode the webhook body first.
    app.post(
        '/webhooks/github',
        express.raw({ type: '*/*' }),
        createSignatureVerificationMiddleware(deps.webhookVerifier, deps.logger),
        createWebhookHandler(deps.orchestrator, deps.logger)
    );

    return app;
}