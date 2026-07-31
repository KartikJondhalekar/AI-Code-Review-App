# AI Code Review GitHub App

> Automatically reviews pull requests for security issues, logic problems, and style violations — posting inline comments on every PR so small engineering teams get consistent feedback without waiting for a senior reviewer.

A production-grade GitHub App that listens for pull request webhooks, fetches the diff, routes it through GPT-4o with structured-output prompting, and posts a structured review directly on the PR. Built with a concurrency-first architecture: rapid re-pushes are debounced and superseded, large diffs are chunked and fanned in through durable state, and installation tokens are refreshed with single-flight coordination.

---

## Contents

- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Concurrency Design](#concurrency-design)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Running It Live](#running-it-live)
- [Configuration](#configuration)
- [HTTP Surface](#http-surface)
- [Observability](#observability)
- [Testing](#testing)
- [Load Testing](#load-testing)
- [Capacity & Scaling](#capacity--scaling)
- [Engineering Decisions](#engineering-decisions)
- [Roadmap](#roadmap)

---

## How It Works

1. A pull request is opened, reopened, or updated on a repo where the App is installed.
2. GitHub delivers a signed webhook to `POST /webhooks/github`.
3. The signature is verified (HMAC-SHA256, timing-safe). The server ACKs `202 Accepted` immediately and runs the review pipeline in a detached background task.
4. A debounce/supersede gate collapses rapid re-pushes so only the newest event for a PR proceeds.
5. The diff is fetched via the GitHub REST API using a cached installation token.
6. A router picks a strategy by diff size: **single-pass** for small diffs, **chunked per-file** (bounded concurrency, durable fan-in) for large ones.
7. GPT-4o returns findings as validated JSON (`file`, `line`, `severity`, `issue`, `suggestion`).
8. A final supersede re-check discards the result if a newer push arrived mid-review; otherwise the review is posted as inline PR comments and persisted to PostgreSQL.

---

## Architecture

```
                                   GitHub.com
                                       │
                          (PR opened / synchronize event)
                                       ▼
                         ┌─────────────────────────┐
                         │   Webhook Receiver       │
                         │  (Express, raw body)     │
                         └───────────┬─────────────┘
                                     ▼
                    ┌─────────────────────────────────┐
                    │ HMAC-SHA256 Signature Verify     │  ── 401 if invalid
                    └────────────────┬────────────────┘
                                     ▼
                          202 Accepted → GitHub
                                     │
                        (detached background pipeline)
                                     ▼
                    ┌─────────────────────────────────┐
                    │ Debounce/Supersede Gate (Redis)   │  ── skip if superseded
                    └────────────────┬──────────────────┘
                                     ▼
                    ┌─────────────────────────────────┐
                    │ GitHub REST (installation token,   │
                    │ single-flight refresh) → fetch diff│
                    └────────────────┬──────────────────┘
                                     ▼
                    ┌─────────────────────────────────┐
                    │ Diff Size Router                  │
                    │  < threshold  ──► Single-Pass      │
                    │  >= threshold ──► Chunk-by-File     │
                    └──────┬──────────────────┬─────────┘
                           ▼                  ▼
                 ┌──────────────┐   ┌───────────────────────┐
                 │ Single LLM   │   │ N Parallel LLM Calls    │
                 │ Call         │   │ (bounded concurrency,   │
                 │              │   │  Postgres fan-in)       │
                 └──────┬───────┘   └───────────┬────────────┘
                        └──────────┬────────────┘
                                   ▼
                    ┌─────────────────────────────────┐
                    │ Structured Output Validation      │
                    │ (JSON schema, strict)             │
                    └────────────────┬──────────────────┘
                                     ▼
                    ┌─────────────────────────────────┐
                    │ Supersede Re-check                │  ── discard if newer event
                    └────────────────┬──────────────────┘
                                     ▼
                    ┌─────────────────────────────────┐
                    │ GitHub REST (post inline comments) │
                    └────────────────┬──────────────────┘
                                     ▼
                    ┌─────────────────────────────────┐
                    │ PostgreSQL (review history)        │
                    └─────────────────────────────────────┘
```

The webhook route ACKs GitHub in milliseconds and processes out of band. This keeps ingestion latency independent of how slow the LLM review is — the pipeline can take 30 seconds without ever risking GitHub's webhook delivery timeout.

---

## Concurrency Design

Three concurrency hazards are handled with durable, externally-owned state (Redis keys, Postgres rows) — never in-process singletons — so horizontal scaling is safe by construction.

**Rapid re-push races.** A developer pushing three commits in ten seconds fires three `synchronize` events. A Redis-backed debounce/supersede gate keyed on `(repo, PR)` ensures only the newest event proceeds; in-flight reviews for superseded events are discarded rather than posted.

**Chunked-review fan-in.** Large diffs split into per-file LLM calls. "Are all chunks done?" is answered by counting committed Postgres rows against a recorded expected count — not an in-memory counter — so it survives a process crash mid-fan-out and is correct across multiple instances.

**Installation token refresh.** GitHub App tokens expire hourly. A Redis `SETNX` lock provides single-flight coordination: concurrent requests for the same installation converge on one refresh call instead of stampeding the token endpoint.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime / Language | Node.js 20+, TypeScript (strict) |
| Web framework | Express |
| Platform | GitHub App (Webhooks, REST API v3) via Octokit |
| AI | OpenAI GPT-4o (structured outputs, JSON schema mode) |
| Database | PostgreSQL (Prisma ORM) |
| Cache / coordination | Redis (ioredis) — debounce gate, token cache |
| Config validation | Zod (immutable, fail-loud at startup) |
| Webhook security | HMAC-SHA256, timing-safe comparison |
| Observability | prom-client (Prometheus), structured JSON logging |
| Testing | Jest, ts-jest, supertest, Testcontainers |
| Load testing | k6 |
| Local infra | Docker Compose (PostgreSQL + Redis) |
| Local webhooks | smee.io |

---

## Project Structure

```
ai-code-review-app/
├── src/
│   ├── config/            # Zod env schema + immutable AppConfig
│   ├── interfaces/        # 8 abstract contracts (DI seams)
│   ├── services/          # Concrete implementations + CircuitBreaker
│   ├── orchestration/     # ReviewOrchestrator (the pipeline)
│   ├── http/              # Middleware, webhook handler, payload parsing
│   ├── observability/     # JSON Logger, Prometheus Metrics
│   ├── utils/             # Bounded-concurrency helper
│   ├── types/             # Domain + GitHub types
│   ├── app.ts             # Express assembly + route registration
│   └── index.ts           # Composition root
├── prisma/
│   └── schema.prisma      # ReviewSession, ReviewSessionChunk, ReviewHistory
├── tests/
│   ├── unit/              # 7 suites (fast, mocked)
│   └── integration/       # 3 suites (Testcontainers: Redis + Postgres)
├── load/
│   └── webhook-load.js    # k6 ingestion load script
├── docker-compose.yml
├── jest.config.js
├── tsconfig.json
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- Docker Desktop
- A registered GitHub App installed on a test repository
- An OpenAI API key with billing enabled

### Register the GitHub App

1. GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Set the **Webhook URL** to your smee.io channel (see below).
3. Set a **Webhook secret** (generate a strong random value; save it).
4. Grant repository permissions: **Pull requests** (read & write), **Contents** (read), **Metadata** (read).
5. Subscribe to the **Pull request** event.
6. Create the App, note the **App ID**, and **generate a private key** (downloads a `.pem`).
7. **Install** the App on a test repository.

### Install & Configure

```bash
git clone <your-repo-url>
cd ai-code-review-app

npm install
cp .env.example .env   # fill in the four real credentials

docker-compose up -d   # PostgreSQL + Redis
npx prisma migrate deploy
```

### Verify configuration loads

```bash
npm run verify:config
# Expected: "Configuration loaded successfully. Environment: development, Port: 3000"
```

---

## Running It Live

Three terminals.

**Terminal 1 — the server**
```bash
npm run dev
```

**Terminal 2 — webhook forwarding** (bridges GitHub → localhost)
```bash
npx smee -u https://smee.io/your-channel --target http://localhost:3000/webhooks/github
```

**Terminal 3 — trigger a review.** On the repo where the App is installed, open a pull request. To force a finding, add a file with an obvious issue:

```javascript
const apiKey = "sk-hardcoded-secret-12345";
db.query(`SELECT * FROM users WHERE id = ${userId}`);
```

Within seconds you'll see structured logs in Terminal 1 (`review pipeline started` → `strategy selected` → `review published`) and an inline review comment appear on the PR flagging the hardcoded secret and the SQL-injection pattern, each with severity and a suggested fix.

Inspect persisted reviews with `npx prisma studio` (the `ReviewHistory` table).

---

## Configuration

All configuration is validated by a Zod schema at startup; an invalid or missing value fails loudly with a descriptive error rather than surfacing as a runtime null later.

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | no | `development` | Runtime environment |
| `PORT` | no | `3000` | HTTP listen port |
| `GITHUB_APP_ID` | yes | — | GitHub App ID |
| `GITHUB_PRIVATE_KEY` | yes | — | PEM private key (quoted, multiline) |
| `GITHUB_WEBHOOK_SECRET` | yes | — | Webhook secret (≥ 16 chars) |
| `OPENAI_API_KEY` | yes | — | OpenAI API key |
| `OPENAI_MODEL` | no | `gpt-4o` | Review model |
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `REDIS_URL` | yes | — | Redis connection string |
| `CHUNK_THRESHOLD_LINES` | no | `150` | Diff size at which chunked review kicks in |
| `MAX_CONCURRENT_CHUNK_CALLS` | no | `5` | Max parallel per-file LLM calls |
| `DEBOUNCE_WINDOW_MS` | no | `5000` | Debounce/supersede window |
| `INSTALLATION_TOKEN_REFRESH_LOCK_TTL_MS` | no | `10000` | Single-flight refresh lock TTL |
| `LLM_CALL_TIMEOUT_MS` | no | `30000` | Per-LLM-call timeout |

---

## HTTP Surface

Intentionally minimal — one functional route plus two operational endpoints.

| Method | Path | Description |
|---|---|---|
| `POST` | `/webhooks/github` | Receives GitHub PR webhooks. Returns `401` (bad signature), `400` (malformed), `204` (ignored event), or `202` (accepted for review) |
| `GET` | `/healthz` | Liveness check |
| `GET` | `/metrics` | Prometheus exposition |

Every response carries an `x-trace-id` correlation header that also appears in the structured logs for that request.

---

## Observability

**Structured logging.** One JSON object per line, request-scoped via child loggers so every line in a pipeline run shares a `traceId` and `deliveryId`.

**Prometheus metrics** (on `/metrics`, application metrics prefixed `acr_`):

| Metric | Type | Labels |
|---|---|---|
| `acr_webhooks_received_total` | counter | `outcome` (accepted/ignored/rejected/malformed) |
| `acr_reviews_completed_total` | counter | `strategy` (single-pass/chunked) |
| `acr_reviews_superseded_total` | counter | `stage` (debounce/post-review) |
| `acr_findings_emitted_total` | counter | `severity` (high/medium/low) |
| `acr_llm_call_duration_seconds` | histogram | `mode` (full/chunk) |
| `acr_review_pipeline_duration_seconds` | histogram | `strategy` |
| `acr_circuit_breaker_state` | gauge | — (0=closed, 1=half-open, 2=open) |
| `acr_chunk_fanout_size` | histogram | — |

Default Node.js process metrics (heap, event-loop lag, GC) are included via `collectDefaultMetrics`.

---

## Testing

Two tiers, separable via Jest projects.

```bash
npm run test:unit          # 7 suites — fast, fully mocked, no Docker
npm run test:integration   # 3 suites — Testcontainers (Docker required)
npm test                   # both
```

**Unit tier** covers HMAC verification, strategy routing, the circuit breaker, webhook payload parsing (table-driven), concurrency bounding, the full orchestrator branch matrix (single-pass, both supersede paths, empty diff, chunked fan-out, partial-failure), and the webhook route contract via supertest.

**Integration tier** spins up real Redis and PostgreSQL to prove what mocks cannot: debounce/supersede timing, single-flight token-refresh collapse (N concurrent calls → exactly one upstream refresh), and Postgres fan-in including upsert idempotency.

---

## Load Testing

A k6 script exercises the ingestion boundary under concurrent signed-payload load.

```bash
npm install -g k6   # or: winget install k6
k6 run -e WEBHOOK_SECRET=<your-webhook-secret> load/webhook-load.js
```

Thresholds assert `p(95) < 250ms` and `p(99) < 500ms` on the webhook ACK, with `< 1%` failures. Because the heavy work is detached, ACK latency stays flat regardless of downstream review time — the load test verifies this holds under 50 concurrent virtual users.

> The load script targets the ingestion path only; it does not call real OpenAI/GitHub. Measuring true end-to-end review throughput requires stubbed upstreams in a dedicated staging harness.

---

## Capacity & Scaling

**Memory.** In-flight background pipelines hold diffs + LLM responses. Watch `nodejs_heap_size_used_bytes`; a sustained figure above ~75% of `--max-old-space-size` signals the need to cap concurrent pipelines or adopt the queue model below.

**Connections.** Peak simultaneous OpenAI connections = `MAX_CONCURRENT_CHUNK_CALLS` × concurrent pipelines — the first thing to hit an org-level rate limit (watch `acr_circuit_breaker_state` trending toward `2`). Prisma's pool can be exhausted by fan-out under burst (watch for pool-timeout errors). GitHub diff-fetch and review-post calls count against the installation's hourly limit.

**Horizontal scaling** is safe by construction — all shared state lives in Redis/Postgres. Add instances behind a load balancer freely. The one caveat: the detached-task model means a killed instance loses its in-flight background reviews. See the roadmap's durability item.

---

## Engineering Decisions

**Why a GitHub App instead of a GitHub Action?** An App installs once and handles all repos centrally — configuration, review history, and analytics live in one place rather than a workflow YAML per repo.

**Why GPT-4o structured outputs instead of parsing free text?** JSON schema mode guarantees a machine-readable response that maps directly to GitHub's review-comment API — no fragile regex, no missed findings.

**Why 202-then-detach instead of processing inline?** The debounce gate alone blocks for `DEBOUNCE_WINDOW_MS`, and the LLM review can take tens of seconds — far beyond GitHub's webhook ACK tolerance. Acknowledging immediately and processing out of band keeps ingestion fast and reliable.

**Why durable state for all concurrency primitives?** In-memory counters and singletons break the moment you run more than one instance. Postgres rows and Redis keys make the debounce gate, fan-in, and token cache correct across instances and across process restarts.

**Why constructor injection everywhere?** No package-level state means each dependency graph is isolated — which is what makes horizontal scaling safe and gives every test clean, uncontaminated state.

---

## Roadmap

The following are described in the original project spec but are **not** part of the current build:

- [ ] Per-repo `.ai-review.yml` config (severity thresholds, ignored paths, focus areas like security-only)
- [ ] BullMQ-based durability — replace fire-and-forget background dispatch with a queue + worker pool for restart-survival, retry/backoff, and dead-lettering (the highest-priority production hardening step)
- [ ] Review analytics dashboard (most-flagged files, issue trends)
- [ ] GitLab Merge Request support (second webhook ingress)
- [ ] Slack notification on high-severity findings
- [ ] Test-coverage-gap detection (flag functions with no test coverage)
- [ ] Stubbed-upstream staging harness for end-to-end throughput measurement

---

## License

See [LICENSE](./LICENSE).