import { createAgentLogger } from '../logger/logger';
import { discordService } from '../services/discord.service';
import { emailService } from '../services/email.service';
import { config } from '../config';

const logger = createAgentLogger('email-report');

interface ReportData {
  projectName: string;
  action: string;
  summary: string;
  changes?: string;
  errors?: string;
  suggestions?: string;
  repoUrl?: string;
  deployUrl?: string;
}

export class EmailReportAgent {
  async sendReport(data: ReportData): Promise<void> {
    const subject = `[Multi-AI-Agent] ${data.action} — ${data.projectName}`;

    const html = [
      '<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">',
      `<h2 style="color: #2563eb;">${data.action}</h2>`,
      `<h3 style="color: #374151;">${data.projectName}</h3>`,
      '<hr style="border: none; border-top: 1px solid #e5e7eb;">',
      '<table style="width: 100%; border-collapse: collapse;">',
      ...Object.entries({
        'Project': data.projectName,
        'Action': data.action,
        'Summary': data.summary,
        'Changes': data.changes,
        'Errors': data.errors,
        'Suggestions': data.suggestions,
        'Repository': data.repoUrl,
        'Deployment': data.deployUrl
      })
        .filter(([_, v]) => v)
        .map(([k, v]) => `<tr><td style="padding: 8px 0; color: #6b7280; width: 120px; vertical-align: top;"><strong>${k}</strong></td><td style="padding: 8px 0;">${v}</td></tr>`),
      '</table>',
      '<hr style="border: none; border-top: 1px solid #e5e7eb;">',
      '<p style="color: #9ca3af; font-size: 12px;">Sent by Multi-AI-Agent DevOps Command Center</p>',
      '</div>'
    ].join('\n');

    const text = [
      `${data.action} — ${data.projectName}`,
      '',
      ...Object.entries({
        Project: data.projectName,
        Action: data.action,
        Summary: data.summary,
        Changes: data.changes,
        Errors: data.errors,
        Suggestions: data.suggestions,
        Repository: data.repoUrl,
        Deployment: data.deployUrl
      })
        .filter(([_, v]) => v)
        .map(([k, v]) => `${k}: ${v}`),
      '',
      'Sent by Multi-AI-Agent DevOps Command Center'
    ].join('\n');

    await emailService.send({
      subject,
      html,
      text,
      to: config.email.to.split(',').map(s => s.trim()).filter(Boolean)
    });

    await discordService.post(`📧 Report sent: **${data.action}** for **${data.projectName}**`, 'Joe');
    logger.info('Email report sent', { subject, to: config.email.to });
  }
}

export const emailReportAgent = new EmailReportAgent();
