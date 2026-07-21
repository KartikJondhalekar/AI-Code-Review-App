import express, { Express } from 'express';
import { AppConfig } from './config/config';
import { IWebhookVerifier } from './interfaces/IWebhookVerifier';
import { IInstallationTokenProvider } from './interfaces/IInstallationTokenProvider';
import { IGitHubDiffFetcher } from './interfaces/IGitHubDiffFetcher';
import { IDiffRouter } from './interfaces/IDiffRouter';
import { ILLMReviewer } from './interfaces/ILLMReviewer';
import { IReviewSessionStore } from './interfaces/IReviewSessionStore';
import { IDebounceGate } from './interfaces/IDebounceGate';
import { IReviewPublisher } from './interfaces/IReviewPublisher';

/**
 * All concrete dependencies the app needs, injected via constructor —
 * no singletons, no package-level state. Phase 3 will supply real
 * implementations of each interface; Phase 4 will wire the webhook route
 * that consumes them.
 */
export interface AppDependencies {
    readonly config: AppConfig;
    readonly webhookVerifier: IWebhookVerifier;
    readonly tokenProvider: IInstallationTokenProvider;
    readonly diffFetcher: IGitHubDiffFetcher;
    readonly diffRouter: IDiffRouter;
    readonly llmReviewer: ILLMReviewer;
    readonly sessionStore: IReviewSessionStore;
    readonly debounceGate: IDebounceGate;
    readonly reviewPublisher: IReviewPublisher;
}

export function createApp(deps: AppDependencies): Express {
    const app = express();

    app.get('/healthz', (_req, res) => {
        res.status(200).json({ status: 'ok' });
    });

    // Webhook route registration happens in Phase 4 — deps are already
    // fully typed and available here for that wiring.

    return app;
}