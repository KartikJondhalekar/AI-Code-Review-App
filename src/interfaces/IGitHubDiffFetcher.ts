import { DiffFile } from '../types/github.types';

/**
 * Retrieves the set of changed files (with patches) for a given PR, using
 * an authenticated installation token.
 */
export interface IGitHubDiffFetcher {
    fetchDiff(params: {
        installationId: number;
        repoFullName: string;
        prNumber: number;
    }): Promise<readonly DiffFile[]>;
}