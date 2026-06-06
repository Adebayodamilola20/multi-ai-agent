import { randomUUID } from 'crypto';
import { createAgentLogger } from '../logger/logger';
import { taskQueue } from '../queue/task-queue';
import { Task, TaskPayload, TaskType } from '../types';

const logger = createAgentLogger('tom-watcher');

type GitHubPayload = Record<string, unknown> & {
  repository?: { full_name?: string; default_branch?: string; pushed_at?: string | number };
  ref?: string;
  after?: string;
  action?: string;
  commits?: Array<{ added?: string[]; modified?: string[]; removed?: string[] }>;
  pull_request?: {
    number?: number;
    title?: string;
    body?: string;
    head?: { ref?: string; sha?: string };
    base?: { ref?: string };
  };
  issue?: { number?: number; title?: string; body?: string };
  check_run?: {
    name?: string;
    conclusion?: string | null;
    head_sha?: string;
    check_suite?: { head_branch?: string };
    output?: { title?: string; summary?: string; text?: string };
  };
  workflow_run?: { name?: string; conclusion?: string | null; head_branch?: string; head_sha?: string };
};

export class WatcherAgent {
  async handleWebhook(eventType: string, payload: GitHubPayload): Promise<Task | null> {
    const task = this.createTask(eventType, payload);
    if (!task) {
      logger.info('Webhook ignored', { eventType });
      return null;
    }

    await taskQueue.add(task);
    logger.info('Webhook converted to task', { eventType, taskType: task.type }, task.id);
    return task;
  }

  async pollRepositories(): Promise<void> {
    logger.debug('Cron poll tick completed. Configure repository polling here for deployments without webhooks.');
  }

  private createTask(eventType: string, payload: GitHubPayload): Task | null {
    const repository = payload.repository?.full_name;
    if (!repository) {
      return null;
    }

    const base: TaskPayload = {
      repository,
      branch: this.extractBranch(eventType, payload),
      commitSha: this.extractCommitSha(eventType, payload),
      files: this.extractFiles(eventType, payload),
      errors: this.extractErrors(eventType, payload),
      eventType,
      issueNumber: payload.issue?.number,
      prNumber: payload.pull_request?.number,
      title: payload.pull_request?.title ?? payload.issue?.title ?? payload.check_run?.name ?? payload.workflow_run?.name,
      description: payload.issue?.body ?? payload.pull_request?.body,
      baseBranch: payload.pull_request?.base?.ref ?? payload.repository?.default_branch
    };

    const type = this.determineTaskType(eventType, payload);
    if (!type) {
      return null;
    }

    return {
      id: randomUUID(),
      type,
      priority: this.priorityFor(eventType, payload),
      payload: base,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  private determineTaskType(eventType: string, payload: GitHubPayload): TaskType | null {
    if (eventType === 'push') {
      return 'review';
    }

    if (eventType === 'pull_request') {
      return payload.action && ['opened', 'synchronize', 'reopened'].includes(payload.action) ? 'review' : null;
    }

    if (eventType === 'check_run') {
      return payload.check_run?.conclusion && payload.check_run.conclusion !== 'success' ? 'fix' : null;
    }

    if (eventType === 'workflow_run') {
      return payload.workflow_run?.conclusion && payload.workflow_run.conclusion !== 'success' ? 'fix' : null;
    }

    if (eventType === 'issues') {
      return payload.action && ['opened', 'reopened'].includes(payload.action) ? 'review' : null;
    }

    return null;
  }

  private priorityFor(eventType: string, payload: GitHubPayload): number {
    if (eventType === 'check_run' || eventType === 'workflow_run') {
      return 1;
    }
    if (payload.action === 'opened') {
      return 2;
    }
    return 5;
  }

  private extractBranch(eventType: string, payload: GitHubPayload): string {
    if (eventType === 'push' && typeof payload.ref === 'string') {
      return payload.ref.replace('refs/heads/', '');
    }
    return (
      payload.pull_request?.head?.ref ??
      payload.check_run?.check_suite?.head_branch ??
      payload.workflow_run?.head_branch ??
      payload.repository?.default_branch ??
      'main'
    );
  }

  private extractCommitSha(eventType: string, payload: GitHubPayload): string {
    return (
      payload.after ??
      payload.pull_request?.head?.sha ??
      payload.check_run?.head_sha ??
      payload.workflow_run?.head_sha ??
      payload.repository?.pushed_at?.toString() ??
      'unknown'
    );
  }

  private extractFiles(eventType: string, payload: GitHubPayload): string[] | undefined {
    if (eventType === 'push' && Array.isArray(payload.commits)) {
      const files = new Set<string>();
      for (const commit of payload.commits) {
        [...(commit.added ?? []), ...(commit.modified ?? []), ...(commit.removed ?? [])].forEach(file => files.add(file));
      }
      return [...files];
    }

    return undefined;
  }

  private extractErrors(eventType: string, payload: GitHubPayload): string[] | undefined {
    if (eventType === 'check_run') {
      const output = payload.check_run?.output;
      return [output?.title, output?.summary, output?.text].filter((value): value is string => Boolean(value));
    }

    if (eventType === 'workflow_run') {
      return [`Workflow ${payload.workflow_run?.name ?? 'unknown'} concluded with ${payload.workflow_run?.conclusion}`];
    }

    if (eventType === 'issues') {
      return [payload.issue?.title, payload.issue?.body].filter((value): value is string => Boolean(value));
    }

    return undefined;
  }
}

export const watcherAgent = new WatcherAgent();
