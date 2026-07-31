import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

/**
 * All application metrics live on one injectable Registry instance — never
 * the prom-client global default registry. This keeps metric state bound to
 * the dependency graph (consistent with Total Isolation) and, critically,
 * gives each test a clean registry rather than counters bleeding across
 * test cases via a shared global.
 */
export class Metrics {
    readonly registry: Registry;

    readonly webhooksReceived: Counter<string>;
    readonly reviewsCompleted: Counter<string>;
    readonly reviewsSuperseded: Counter<string>;
    readonly findingsEmitted: Counter<string>;
    readonly llmCallDuration: Histogram<string>;
    readonly reviewPipelineDuration: Histogram<string>;
    readonly circuitBreakerState: Gauge<string>;
    readonly chunkFanoutSize: Histogram<string>;

    constructor() {
        this.registry = new Registry();
        collectDefaultMetrics({ register: this.registry }); // process CPU, memory, event loop lag

        this.webhooksReceived = new Counter({
            name: 'acr_webhooks_received_total',
            help: 'Total webhook deliveries received, by outcome',
            labelNames: ['outcome'], // accepted | ignored | rejected | malformed
            registers: [this.registry],
        });

        this.reviewsCompleted = new Counter({
            name: 'acr_reviews_completed_total',
            help: 'Total reviews published, by strategy',
            labelNames: ['strategy'], // single-pass | chunked
            registers: [this.registry],
        });

        this.reviewsSuperseded = new Counter({
            name: 'acr_reviews_superseded_total',
            help: 'Reviews discarded due to supersede, by stage',
            labelNames: ['stage'], // debounce | post-review
            registers: [this.registry],
        });

        this.findingsEmitted = new Counter({
            name: 'acr_findings_emitted_total',
            help: 'Total findings posted to PRs, by severity',
            labelNames: ['severity'], // high | medium | low
            registers: [this.registry],
        });

        this.llmCallDuration = new Histogram({
            name: 'acr_llm_call_duration_seconds',
            help: 'OpenAI review call latency',
            labelNames: ['mode'], // full | chunk
            buckets: [0.5, 1, 2, 5, 10, 20, 30],
            registers: [this.registry],
        });

        this.reviewPipelineDuration = new Histogram({
            name: 'acr_review_pipeline_duration_seconds',
            help: 'End-to-end review pipeline latency, by strategy',
            labelNames: ['strategy'],
            buckets: [1, 2, 5, 10, 20, 40, 60],
            registers: [this.registry],
        });

        this.circuitBreakerState = new Gauge({
            name: 'acr_circuit_breaker_state',
            help: 'LLM circuit breaker state (0=closed, 1=half-open, 2=open)',
            registers: [this.registry],
        });

        this.chunkFanoutSize = new Histogram({
            name: 'acr_chunk_fanout_size',
            help: 'Number of file chunks per chunked review',
            buckets: [2, 5, 10, 20, 40, 80],
            registers: [this.registry],
        });
    }
}