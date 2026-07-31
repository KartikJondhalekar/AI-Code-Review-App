import http from 'k6/http';
import crypto from 'k6/crypto';
import { check } from 'k6';

// The webhook secret must match GITHUB_WEBHOOK_SECRET. Passed at runtime:
//   k6 run -e WEBHOOK_SECRET=<secret> load/webhook-load.js
const SECRET = __ENV.WEBHOOK_SECRET;
const TARGET = __ENV.TARGET || 'http://localhost:3000/webhooks/github';

export const options = {
    scenarios: {
        // Sustained concurrent PR events across many synthetic repos/PRs.
        steady_load: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '15s', target: 20 },
                { duration: '30s', target: 20 },
                { duration: '15s', target: 50 },
                { duration: '30s', target: 50 },
                { duration: '10s', target: 0 },
            ],
        },
    },
    thresholds: {
        // The webhook ACK must stay fast — the heavy work is detached, so the
        // request/response cycle should be dominated by signature verification
        // and payload parsing, not the LLM pipeline.
        http_req_duration: ['p(95)<250', 'p(99)<500'],
        http_req_failed: ['rate<0.01'],
    },
};

function signedBody(vu, iter) {
    const body = JSON.stringify({
        action: 'synchronize',
        installation: { id: 1 },
        // Spread load across synthetic PRs so the debounce gate does not collapse
        // everything into one supersede chain (that would under-exercise the path).
        repository: { full_name: `loadtest/repo-${vu % 10}` },
        pull_request: { number: (iter % 50) + 1, head: { sha: `sha-${vu}-${iter}` } },
    });
    const signature = 'sha256=' + crypto.hmac('sha256', SECRET, body, 'hex');
    return { body, signature };
}

export default function () {
    const { body, signature } = signedBody(__VU, __ITER);
    const res = http.post(TARGET, body, {
        headers: {
            'Content-Type': 'application/json',
            'X-GitHub-Event': 'pull_request',
            'X-GitHub-Delivery': `load-${__VU}-${__ITER}`,
            'X-Hub-Signature-256': signature,
        },
    });

    check(res, {
        'status is 202 (accepted)': (r) => r.status === 202,
        'trace id header present': (r) => r.headers['X-Trace-Id'] !== undefined,
    });
}