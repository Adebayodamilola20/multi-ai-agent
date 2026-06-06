import { mkdir, writeFile, appendFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { config } from '../config';
import { createAgentLogger } from '../logger/logger';
import { Task } from '../types';

const logger = createAgentLogger('neo-obsidian');

const AGENT_NAMES: Record<string, string> = {
  'tom': 'Tom',
  'jim': 'Jim',
  'sammy': 'Sammy',
  'alexa': 'Alexa',
  'joe': 'Joe',
  'neo': 'Neo'
};

type TaskEvent = 'started' | 'completed' | 'failed';

export class ObsidianService {
  private initialized = false;

  private get basePath(): string {
    return path.join(config.obsidian.vaultPath, 'Multi-AI-Agent');
  }

  async init(): Promise<void> {
    if (!config.obsidian.vaultPath) {
      logger.warn('OBSIDIAN_VAULT_PATH not set — Obsidian sync disabled');
      return;
    }
    await this.ensureDir('Tasks');
    await this.ensureDir('Agents');
    await this.ensureDir('Repos');
    await this.ensureDir('Discord');
    await this.writeIndex();
    this.initialized = true;
    logger.info('Obsidian vault initialized', { vaultPath: config.obsidian.vaultPath });
  }

  async logTaskEvent(task: Task, event: TaskEvent, detail?: string): Promise<void> {
    if (!this.initialized) return;
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const dayDir = path.join('Tasks', dateStr);
      await this.ensureDir(dayDir);

      const shortId = task.id.slice(0, 8);
      const filePath = path.join(this.basePath, dayDir, `task-${shortId}.md`);

      if (event === 'started' || !existsSync(filePath)) {
        await this.writeTaskNote(filePath, task);
      }
      if (event !== 'started') {
        await this.appendTaskEvent(filePath, task, event, detail);
      }

      await this.updateAgentNote(task, event);
      await this.updateRepoNote(task, event);
    } catch (error) {
      logger.error('Obsidian write failed', { error: (error as Error).message, taskId: task.id });
    }
  }

  private async writeTaskNote(filePath: string, task: Task): Promise<void> {
    const dateStr = new Date(task.createdAt).toLocaleString();
    const repoSlug = task.payload.repository.replace('/', '_');
    const content = [
      '---',
      `task_id: "${task.id}"`,
      `type: ${task.type}`,
      `status: ${task.status}`,
      `repository: "${task.payload.repository}"`,
      `branch: "${task.payload.branch}"`,
      `event: ${task.payload.eventType}`,
      `created: ${dateStr}`,
      '---',
      '',
      `# Task ${task.id.slice(0, 8)} — ${task.type}`,
      '',
      `**Type:** \`${task.type}\``,
      `**Repository:** [[Repos/${repoSlug}|${task.payload.repository}]]`,
      `**Branch:** \`${task.payload.branch}\``,
      `**Event:** ${task.payload.eventType}`,
      `**Status:** \`${task.status}\``,
      `**Created:** ${dateStr}`,
      '',
      '## Events',
      '',
      `- 🟢 **Started** at ${dateStr}`
    ].join('\n');

    await writeFile(filePath, content + '\n', 'utf8');
  }

  private async appendTaskEvent(filePath: string, task: Task, event: TaskEvent, detail?: string): Promise<void> {
    const now = new Date().toLocaleString();
    const icons: Record<TaskEvent, string> = { started: '🟢', completed: '✅', failed: '❌' };
    const statuses: Record<TaskEvent, string> = { started: 'Started', completed: 'Completed', failed: 'Failed' };

    const line = `- ${icons[event]} **${statuses[event]}** at ${now}${detail ? ` — ${detail}` : ''}`;
    await appendFile(filePath, line + '\n', 'utf8');
  }

  private async updateAgentNote(task: Task, event: TaskEvent): Promise<void> {
    const agentKey = task.type === 'review' ? 'jim' : task.type === 'fix' ? 'sammy' : task.type === 'test' || task.type === 'pr' ? 'alexa' : task.type === 'email' || task.type === 'notify' ? 'joe' : 'tom';
    const agentName = AGENT_NAMES[agentKey] || 'Tom';
    const filePath = path.join(this.basePath, 'Agents', `${agentName}.md`);

    if (!existsSync(filePath)) {
      const header = [
        `# ${agentName}`,
        '',
        '## Task Timeline',
        ''
      ].join('\n');
      await writeFile(filePath, header, 'utf8');
    }

    const shortId = task.id.slice(0, 8);
    const repoSlug = task.payload.repository.replace('/', '_');
    const icons: Record<TaskEvent, string> = { started: '🟢', completed: '✅', failed: '❌' };
    const now = new Date().toLocaleString();
    const line = `${icons[event]} **${now}** — [[Tasks/${new Date().toISOString().slice(0, 10)}/task-${shortId}|Task ${shortId}]] — ${task.payload.repository} (\`${task.type}\`)`;
    await appendFile(filePath, line + '\n', 'utf8');
  }

  private async updateRepoNote(task: Task, event: TaskEvent): Promise<void> {
    const repoSlug = task.payload.repository.replace('/', '_');
    const filePath = path.join(this.basePath, 'Repos', `${repoSlug}.md`);

    if (!existsSync(filePath)) {
      const header = [
        `# ${task.payload.repository}`,
        '',
        '## Activity',
        ''
      ].join('\n');
      await writeFile(filePath, header, 'utf8');
    }

    const shortId = task.id.slice(0, 8);
    const icons: Record<TaskEvent, string> = { started: '🟢', completed: '✅', failed: '❌' };
    const now = new Date().toLocaleString();
    const line = `${icons[event]} **${now}** — [[Tasks/${new Date().toISOString().slice(0, 10)}/task-${shortId}|Task ${shortId}]] (\`${task.type}\`)`;
    await appendFile(filePath, line + '\n', 'utf8');
  }

  async logDiscordMessage(user: string, userMsg: string, agent: string, reply: string): Promise<void> {
    if (!this.initialized) return;
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const filePath = path.join(this.basePath, 'Discord', `${dateStr}.md`);
      const now = new Date().toLocaleString();

      const line = `- **${now}** — **${user}**: ${userMsg} → **[[Agents/${agent}|${agent}]]**: ${reply}`;
      const agentRef = `[[Agents/${agent}|${agent}]]`;

      if (!existsSync(filePath)) {
        const header = [
          `# Discord — ${dateStr}`,
          '',
          '## Conversations',
          ''
        ].join('\n');
        await writeFile(filePath, header + line + '\n', 'utf8');
      } else {
        await appendFile(filePath, line + '\n', 'utf8');
      }
    } catch (error) {
      logger.error('Obsidian Discord log failed', { error: (error as Error).message });
    }
  }

  private async writeIndex(): Promise<void> {
    const filePath = path.join(this.basePath, 'Index.md');
    if (existsSync(filePath)) return;

    const content = [
      '# Multi-AI-Agent Vault',
      '',
      '## Agents',
      '- [[Agents/Tom|Tom]] — Manager',
      '- [[Agents/Jim|Jim]] — Code Reviewer',
      '- [[Agents/Sammy|Sammy]] — Fixer',
      '- [[Agents/Alexa|Alexa]] — Tester & PR',
      '- [[Agents/Joe|Joe]] — Notifications',
      '- [[Agents/Neo|Neo]] — Vault Scribe',
      '',
      '## Recent Tasks',
      '',
      '> *Tasks are organized by date under Tasks/*',
      '',
      '## Repositories',
      '',
      '> *Repo activity logs are under Repos/*',
      '',
      '## Discord Chats',
      '',
      '> *Daily conversation logs are under Discord/*',
      ''
    ].join('\n');
    await writeFile(filePath, content, 'utf8');
  }

  private async ensureDir(subPath: string): Promise<void> {
    const dir = path.join(this.basePath, subPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }
}

export const obsidianService = new ObsidianService();
