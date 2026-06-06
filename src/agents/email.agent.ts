import { config } from '../config';
import { createAgentLogger } from '../logger/logger';
import { emailService } from '../services/email.service';
import { Task } from '../types';
import { discordAgent } from './discord.agent';
import { slackAgent } from './slack.agent';

const logger = createAgentLogger('joe');

const EMOJIS: Record<string, string> = {
  Tom: '🟢',
  Jim: '🔵',
  Sammy: '🟠',
  Alexa: '🟣',
  Joe: '🔴'
};

export class EmailAgent {
  async notifyLifecycle(agent: string, task: Task, message: string): Promise<void> {
    const emoji = EMOJIS[agent] ?? '';
    const formatted = `${emoji} **[${agent}]** Task #${task.id.slice(0, 8)} — ${message}`;
    logger.info(formatted, { repository: task.payload.repository, branch: task.payload.branch }, task.id);

    await Promise.allSettled([
      discordAgent.notify(formatted),
      slackAgent.notify(formatted)
    ]);
  }

  async notifyDetailed(agent: string, task: Task, message: string): Promise<void> {
    const emoji = EMOJIS[agent] ?? '';
    const formatted = `${emoji} **${agent}** ${message}`;
    logger.info(formatted, { repository: task.payload.repository }, task.id);

    await Promise.allSettled([
      discordAgent.notify(formatted),
      slackAgent.notify(formatted)
    ]);
  }

  async sendSummary(task: Task, subject?: string): Promise<void> {
    const title = subject ?? `Multi-AI-Agent summary for ${task.payload.repository}`;
    const rows = [
      ['Task', task.id],
      ['Type', task.type],
      ['Repository', task.payload.repository],
      ['Branch', task.payload.branch],
      ['Commit', task.payload.commitSha],
      ['Event', task.payload.eventType],
      ['PR', task.payload.prUrl ?? task.result?.prUrl ?? 'N/A'],
      ['Status', task.status]
    ];

    const htmlRows = rows
      .map(([label, value]) => `<tr><th align="left">${label}</th><td>${String(value)}</td></tr>`)
      .join('');
    const errors = task.payload.errors?.length
      ? `<h3>Errors</h3><pre>${task.payload.errors.join('\n')}</pre>`
      : '';
    const review = task.payload.reviewResults?.length
      ? `<h3>Review Findings</h3><ul>${task.payload.reviewResults
          .map(item => `<li>${item.severity.toUpperCase()} ${item.file}:${item.line} - ${item.message}</li>`)
          .join('')}</ul>`
      : '';

    const html = `<h2>${title}</h2><table>${htmlRows}</table>${errors}${review}`;
    const text = rows.map(([label, value]) => `${label}: ${value}`).join('\n');

    await emailService.send({
      subject: title,
      html,
      text,
      to: config.email.to.split(',').map(value => value.trim()).filter(Boolean)
    });
  }
}

export const emailAgent = new EmailAgent();
