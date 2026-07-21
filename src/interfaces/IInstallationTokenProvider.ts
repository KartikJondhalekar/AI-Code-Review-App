import { InstallationToken } from '../types/github.types';

/**
 * Supplies a valid GitHub App installation access token for a given
 * installation ID. Implementations are responsible for caching and
 * single-flight refresh coordination —
 * callers never see expired tokens and never trigger redundant refreshes.
 */
export interface IInstallationTokenProvider {
    getToken(installationId: number): Promise<InstallationToken>;
}