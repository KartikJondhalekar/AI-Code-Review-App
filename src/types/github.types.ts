export interface InstallationToken {
    readonly token: string;
    readonly expiresAt: Date;
}

export interface PullRequestWebhookPayload {
    readonly action: string;
    readonly installationId: number;
    readonly repoFullName: string;
    readonly prNumber: number;
    readonly headSha: string;
    readonly deliveryId: string;
}

export interface DiffFile {
    readonly path: string;
    readonly patch: string;
    readonly additions: number;
    readonly deletions: number;
    readonly changedLines: number;
}