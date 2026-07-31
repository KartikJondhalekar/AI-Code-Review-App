import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { loadConfig, ConfigValidationError } from './config/config';
import { JsonLogger } from './observability/Logger';
import { WebhookVerifier } from './services/WebhookVerifier';
import { InstallationTokenProvider } from './services/InstallationTokenProvider';
import { GitHubDiffFetcher } from './services/GitHubDiffFetcher';
import { DiffRouter } from './services/DiffRouter';
import { LLMReviewer } from './services/LLMReviewer';
import { ReviewSessionStore } from './services/ReviewSessionStore';
import { ReviewHistoryStore } from './services/ReviewHistoryStore';
import { DebounceGate } from './services/DebounceGate';
import { ReviewPublisher } from './services/ReviewPublisher';
import { ReviewOrchestrator } from './orchestration/ReviewOrchestrator';
import { createApp } from './app';
import { Metrics } from './observability/Metrics';

function main(): void {
    let config;
    try {
        config = loadConfig();
    } catch (err) {
        if (err instanceof ConfigValidationError) {
            console.error(err.message);
            process.exit(1);
        }
        throw err;
    }

    const logger = new JsonLogger({ service: 'ai-code-review-app', env: config.nodeEnv });
    const metrics = new Metrics();                                    

    const prisma = new PrismaClient();
    const redis = new Redis(config.redisUrl);

    const tokenProvider = new InstallationTokenProvider(
        redis,
        config.github.appId,
        config.github.privateKey,
        config.review.tokenRefreshLockTtlMs
    );

    const orchestrator = new ReviewOrchestrator({
        config,
        logger,
        metrics,
        diffFetcher: new GitHubDiffFetcher(tokenProvider),
        diffRouter: new DiffRouter(config.review.chunkThresholdLines),
        llmReviewer: new LLMReviewer(config.openai.apiKey, config.openai.model, config.openai.callTimeoutMs, metrics),
        sessionStore: new ReviewSessionStore(prisma),
        historyStore: new ReviewHistoryStore(prisma),
        debounceGate: new DebounceGate(redis, config.review.debounceWindowMs),
        reviewPublisher: new ReviewPublisher(tokenProvider),
    });

    const app = createApp({
        config,
        logger,
        metrics,
        webhookVerifier: new WebhookVerifier(config.github.webhookSecret),
        orchestrator,
    });

    const server = app.listen(config.port, () => {
        logger.info('server listening', { port: config.port });
    });

    const shutdown = (signal: string): void => {
        logger.info('shutdown initiated', { signal });
        server.close(() => {
            void prisma.$disconnect();
            redis.disconnect();
            process.exit(0);
        });
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

main();