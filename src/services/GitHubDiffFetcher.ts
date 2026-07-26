import { Octokit } from '@octokit/rest';
import { IGitHubDiffFetcher } from '../interfaces/IGitHubDiffFetcher';
import { IInstallationTokenProvider } from '../interfaces/IInstallationTokenProvider';
import { DiffFile } from '../types/github.types';

export class GitHubDiffFetcher implements IGitHubDiffFetcher {
    constructor(private readonly tokenProvider: IInstallationTokenProvider) { }

    async fetchDiff(params: {
        installationId: number;
        repoFullName: string;
        prNumber: number;
    }): Promise<readonly DiffFile[]> {
        const { installationId, repoFullName, prNumber } = params;
        const { token } = await this.tokenProvider.getToken(installationId);
        const octokit = new Octokit({ auth: token });
        const [owner, repo] = repoFullName.split('/');

        const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
            owner,
            repo,
            pull_number: prNumber,
            per_page: 100,
        });

        // Files without a textual patch (binaries, files too large for GitHub
        // to compute a diff for) are excluded — there is nothing for the LLM
        // to review in a patch-less entry.
        return files
            .filter((file) => typeof file.patch === 'string')
            .map((file) => ({
                path: file.filename,
                patch: file.patch as string,
                additions: file.additions,
                deletions: file.deletions,
                changedLines: file.additions + file.deletions,
            }));
    }
}