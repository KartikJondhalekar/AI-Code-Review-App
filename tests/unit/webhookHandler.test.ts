import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { createTraceMiddleware, createSignatureVerificationMiddleware } from '../../src/http/middleware';
import { createWebhookHandler } from '../../src/http/webhookHandler';
import { WebhookVerifier } from '../../src/services/WebhookVerifier';
import { Metrics } from '../../src/observability/Metrics';

const SECRET = 'unit-test-secret-value';
const silentLogger = () => {
    const l: any = {};
    l.child = () => l;
    l.debug = jest.fn();
    l.info = jest.fn();
    l.warn = jest.fn();
    l.error = jest.fn();
    return l;
};

function buildTestApp(processMock: jest.Mock) {
    const logger = silentLogger();
    const metrics = new Metrics();
    const orchestrator: any = { processReviewRequest: processMock };
    const app = express();
    app.use(createTraceMiddleware());
    app.post(
        '/webhooks/github',
        express.raw({ type: '*/*' }),
        createSignatureVerificationMiddleware(new WebhookVerifier(SECRET), logger, metrics),  // ← metrics
        createWebhookHandler(orchestrator, logger, metrics)
    );
    return app;
}

const sign = (body: string) => 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');

describe('webhook route contract', () => {
    it('401 on invalid signature, orchestrator never invoked', async () => {
        const proc = jest.fn().mockResolvedValue(undefined);
        const body = JSON.stringify({ action: 'opened' });
        const res = await request(buildTestApp(proc))
            .post('/webhooks/github')
            .set('x-github-event', 'pull_request')
            .set('x-hub-signature-256', 'sha256=bad')
            .set('content-type', 'application/json')
            .send(body);

        expect(res.status).toBe(401);
        expect(proc).not.toHaveBeenCalled();
    });

    it('204 on a valid but ignored ping event', async () => {
        const proc = jest.fn().mockResolvedValue(undefined);
        const body = JSON.stringify({ zen: 'x' });
        const res = await request(buildTestApp(proc))
            .post('/webhooks/github')
            .set('x-github-event', 'ping')
            .set('x-hub-signature-256', sign(body))
            .set('content-type', 'application/json')
            .send(body);

        expect(res.status).toBe(204);
        expect(proc).not.toHaveBeenCalled();
    });

    it('400 on valid signature but malformed payload', async () => {
        const proc = jest.fn().mockResolvedValue(undefined);
        const body = '{not valid json';
        const res = await request(buildTestApp(proc))
            .post('/webhooks/github')
            .set('x-github-event', 'pull_request')
            .set('x-hub-signature-256', sign(body))
            .set('content-type', 'application/json')
            .send(body);

        expect(res.status).toBe(400);
        expect(proc).not.toHaveBeenCalled();
    });

    it('202 on a valid PR event and dispatches the background pipeline', async () => {
        const proc = jest.fn().mockResolvedValue(undefined);
        const body = JSON.stringify({
            action: 'opened',
            installation: { id: 1 },
            repository: { full_name: 'a/b' },
            pull_request: { number: 3, head: { sha: 's' } },
        });
        const res = await request(buildTestApp(proc))
            .post('/webhooks/github')
            .set('x-github-event', 'pull_request')
            .set('x-github-delivery', 'del-x')
            .set('x-hub-signature-256', sign(body))
            .set('content-type', 'application/json')
            .send(body);

        expect(res.status).toBe(202);
        expect(res.headers['x-trace-id']).toBeDefined();
        expect(proc).toHaveBeenCalledTimes(1);
    });

    it('202 is returned even when the background task rejects (error is swallowed + logged)', async () => {
        const proc = jest.fn().mockRejectedValue(new Error('pipeline boom'));
        const body = JSON.stringify({
            action: 'synchronize',
            installation: { id: 1 },
            repository: { full_name: 'a/b' },
            pull_request: { number: 3, head: { sha: 's' } },
        });
        const res = await request(buildTestApp(proc))
            .post('/webhooks/github')
            .set('x-github-event', 'pull_request')
            .set('x-hub-signature-256', sign(body))
            .set('content-type', 'application/json')
            .send(body);

        expect(res.status).toBe(202); // client is unaffected by background failure
    });
});