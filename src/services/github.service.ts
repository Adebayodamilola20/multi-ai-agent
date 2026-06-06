import { Octokit } from '@octokit/rest';
import { config } from '../config';
import { createAgentLogger } from '../logger/logger';
import { GitHubDiff, GitHubFile, GitHubRepository, PullRequestData } from '../types';

const logger = createAgentLogger('github-service');

export class GitHubService {
  private readonly octokit: Octokit;

  constructor(octokit = new Octokit({ auth: config.github.token })) {
    this.octokit = octokit;
  }

  parseRepository(repository: string): GitHubRepository {
    const [owner, repo] = repository.split('/');
    if (!owner || !repo) {
      throw new Error(`Invalid repository format "${repository}". Expected owner/repo.`);
    }

    return { owner, repo, defaultBranch: 'main' };
  }

  async getDefaultBranch(repository: string): Promise<string> {
    const { owner, repo } = this.parseRepository(repository);
    const response = await this.octokit.repos.get({ owner, repo });
    return response.data.default_branch;
  }

  async getPullRequestFiles(repository: string, pullNumber: number): Promise<string[]> {
    const { owner, repo } = this.parseRepository(repository);
    const files = await this.octokit.paginate(this.octokit.pulls.listFiles, {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100
    });

    return files.map(file => file.filename);
  }

  async getCommitFiles(repository: string, commitSha: string): Promise<string[]> {
    const { owner, repo } = this.parseRepository(repository);
    const response = await this.octokit.repos.getCommit({ owner, repo, ref: commitSha });
    return (response.data.files ?? []).map(file => file.filename);
  }

  async getDiffs(repository: string, commitSha: string, files?: string[]): Promise<GitHubDiff[]> {
    const { owner, repo } = this.parseRepository(repository);
    const response = await this.octokit.repos.getCommit({ owner, repo, ref: commitSha });
    const selected = new Set(files ?? []);

    return (response.data.files ?? [])
      .filter(file => selected.size === 0 || selected.has(file.filename))
      .map(file => ({
        file: file.filename,
        patch: file.patch ?? '',
        additions: file.additions,
        deletions: file.deletions
      }));
  }

  async getFile(repository: string, path: string, ref: string): Promise<GitHubFile> {
    const { owner, repo } = this.parseRepository(repository);
    const response = await this.octokit.repos.getContent({ owner, repo, path, ref });

    if (Array.isArray(response.data) || response.data.type !== 'file') {
      throw new Error(`${path} is not a file in ${repository}@${ref}`);
    }

    const encoded = response.data.content ?? '';
    const content = Buffer.from(encoded, 'base64').toString('utf8');
    return { path, content, sha: response.data.sha };
  }

  async getBranchSha(repository: string, branch: string): Promise<string> {
    const { owner, repo } = this.parseRepository(repository);
    const response = await this.octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`
    });

    return response.data.object.sha;
  }

  async createBranch(repository: string, sourceBranch: string, newBranch: string): Promise<void> {
    if (newBranch === 'main' || newBranch === 'master') {
      throw new Error('Refusing to create or use a protected main branch for fixes.');
    }

    const { owner, repo } = this.parseRepository(repository);
    const sourceSha = await this.getBranchSha(repository, sourceBranch);

    try {
      await this.octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${newBranch}`,
        sha: sourceSha
      });
      logger.info('Created branch', { repository, sourceBranch, newBranch });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 422) {
        throw error;
      }
      logger.warn('Branch already exists, reusing it', { repository, newBranch });
    }
  }

  async commitFiles(
    repository: string,
    branch: string,
    files: Array<{ path: string; content: string }>,
    message: string
  ): Promise<string> {
    if (branch === 'main' || branch === 'master') {
      throw new Error('Sammy safeguard: refusing to commit directly to main/master.');
    }

    const { owner, repo } = this.parseRepository(repository);
    let latestCommitSha = '';

    for (const file of files) {
      const existing = await this.getFile(repository, file.path, branch);
      const response = await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: file.path,
        branch,
        message,
        content: Buffer.from(file.content, 'utf8').toString('base64'),
        sha: existing.sha
      });
      latestCommitSha = response.data.commit.sha ?? latestCommitSha;
    }

    if (!latestCommitSha) {
      throw new Error('GitHub did not return a commit SHA for the file update.');
    }

    return latestCommitSha;
  }

  async pushBranch(repository: string, branch: string): Promise<void> {
    if (branch === 'main' || branch === 'master') {
      throw new Error('Alexa safeguard: refusing to push protected main/master branch.');
    }

    logger.info('Branch is already updated through GitHub Contents API', { repository, branch });
  }

  async getReadme(repository: string): Promise<string> {
    const { owner, repo } = this.parseRepository(repository);
    const response = await this.octokit.repos.getReadme({ owner, repo });
    const content = Buffer.from(response.data.content, 'base64').toString('utf8');
    return content;
  }

  async listRepos(): Promise<Array<{ name: string; description: string | null; private: boolean; url: string }>> {
    const repos = await this.octokit.paginate(this.octokit.repos.listForAuthenticatedUser, {
      sort: 'updated',
      per_page: 50,
      visibility: 'all'
    });
    return repos.map(r => ({
      name: r.full_name,
      description: r.description,
      private: r.private,
      url: r.html_url
    }));
  }

  async createPullRequest(repository: string, data: PullRequestData): Promise<string> {
    if (data.head === data.base) {
      throw new Error('Refusing to create a pull request where head and base are the same branch.');
    }

    const { owner, repo } = this.parseRepository(repository);
    const response = await this.octokit.pulls.create({
      owner,
      repo,
      title: data.title,
      body: data.body,
      head: data.head,
      base: data.base,
      draft: data.draft
    });

    return response.data.html_url;
  }

  async getLatestPullRequest(repository: string, state: 'open' | 'closed' | 'all' = 'all'): Promise<{ number: number; title: string; head: { ref: string }; html_url: string } | null> {
    const { owner, repo } = this.parseRepository(repository);
    const response = await this.octokit.pulls.list({ owner, repo, state, sort: 'created', direction: 'desc', per_page: 1 });
    if (response.data.length === 0) return null;
    const pr = response.data[0];
    return { number: pr.number, title: pr.title, head: { ref: pr.head.ref }, html_url: pr.html_url };
  }

  async closePullRequest(repository: string, prNumber: number): Promise<void> {
    const { owner, repo } = this.parseRepository(repository);
    await this.octokit.pulls.update({ owner, repo, pull_number: prNumber, state: 'closed' });
  }

  async deleteBranch(repository: string, branch: string): Promise<void> {
    const { owner, repo } = this.parseRepository(repository);
    await this.octokit.git.deleteRef({ owner, repo, ref: `heads/${branch}` });
  }
}

export const githubService = new GitHubService();
