import { createAgentLogger } from '../logger/logger';
import { githubService } from '../services/github.service';
import { safetyAgent } from './safety.agent';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { config } from '../config';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/**
 * GitHub Agent – high‑level wrapper around GitHubService for voice/desktop use.
 * All potentially destructive actions (clone, push, delete branch) go through SafetyAgent.
 */
export class GitHubAgent {
  private logger = createAgentLogger('github-agent');

  /** Get a concise README summary using the LLM */
  async getReadmeSummary(repo: string): Promise<string> {
    const readme = await githubService.getReadme(repo);
    // Simple LLM call – reuse llmService directly
    const { OpenAI } = await import('openai'); // dynamically import to avoid circular deps
    
    const client = new OpenAI({ apiKey: config.openai.apiKey });
    const resp = await client.chat.completions.create({
      model: config.openai.model,
      temperature: 0.4,
      messages: [
        { role: 'system', content: 'Summarize the given README in 3‑5 sentences for a senior engineer.' },
        { role: 'user', content: readme }
      ]
    });
    return resp.choices[0]?.message.content?.trim() ?? '';
  }

  /** List branches of a repository */
  async listBranches(repo: string): Promise<string[]> {
    // GitHub API does not have a direct list‑branches method in this service; use octokit directly
    const { Octokit } = await import('@octokit/rest');
    
    const octokit = new Octokit({ auth: config.github.token });
    const [owner, name] = repo.split('/');
    const response = await octokit.repos.listBranches({ owner, repo: name });
    return response.data.map(b => b.name);
  }

  /** Clone a public repo to a local path (after user confirmation) */
  async cloneRepo(repoUrl: string, targetDir: string): Promise<string> {
    const approved = await safetyAgent.confirm(`Clone repository ${repoUrl} into ${targetDir}`);
    if (!approved) return 'Clone cancelled by user.';
    const absTarget = path.resolve(targetDir);
    await execAsync(`git clone ${repoUrl} ${absTarget}`);
    return `Cloned ${repoUrl} to ${absTarget}`;
  }

  /** Create a pull request */
  async createPullRequest(repo: string, title: string, body: string, head: string, base: string = 'main'): Promise<string> {
    const approved = await safetyAgent.confirm(`Create PR in ${repo}: ${title}`);
    if (!approved) return 'PR creation cancelled by user.';
    return await githubService.createPullRequest(repo, { title, body, head, base, draft: false });
  }

  /** List recent commits (last 5) */
  async recentCommits(repo: string, branch = 'main', count = 5): Promise<Array<{ sha: string; message: string }>> {
    const { Octokit } = await import('@octokit/rest');
    
    const octokit = new Octokit({ auth: config.github.token });
    const [owner, name] = repo.split('/');
    const resp = await octokit.repos.listCommits({ owner, repo: name, sha: branch, per_page: count });
    return resp.data.map(c => ({ sha: c.sha, message: c.commit?.message ?? '' }));
  }
}

export const githubAgent = new GitHubAgent();
