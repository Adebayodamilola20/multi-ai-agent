import { createAgentLogger } from '../logger/logger';
import { discordService } from '../services/discord.service';
import { renderService } from '../services/render.service';
import { memoryService } from '../services/memory.service';
import { RenderServiceInfo } from '../types';

const logger = createAgentLogger('server-monitor');

export class ServerMonitorAgent {
  async checkAll(): Promise<string> {
    await discordService.post('🔍 Checking all Render services...', 'Alexa');

    try {
      const services = await renderService.getServices();
      if (services.length === 0) {
        await discordService.post('No Render services configured.', 'Alexa');
        return 'No services';
      }

      const results = await Promise.allSettled(
        services.map(svc => this.checkService(svc))
      );

      const lines: string[] = ['📊 **Render Service Status:**\n'];
      for (const result of results) {
        if (result.status === 'fulfilled') lines.push(result.value);
        else lines.push(`❌ Check error: ${result.reason}`);
      }

      const report = lines.join('\n');
      await discordService.post(report, 'Alexa');

      memoryService.rememberProject('render', {
        notes: report,
        timestamp: new Date().toISOString()
      });

      return report;
    } catch (error) {
      const msg = `❌ Render check failed: ${(error as Error).message}`;
      await discordService.post(msg, 'Alexa');
      return msg;
    }
  }

  private async checkService(svc: RenderServiceInfo): Promise<string> {
    try {
      const deploy = await renderService.getLatestDeploy(svc.id);
      if (!deploy) return `⚠️ **${svc.name}** — No deploys found`;

      const status = deploy.status;
      const commitMsg = deploy.commit?.message?.slice(0, 80) || 'no commit message';
      const finished = deploy.finishedAt ? new Date(deploy.finishedAt).toLocaleString() : 'in progress';

      const env = svc.serviceDetails?.env || 'unknown';
      const plan = svc.serviceDetails?.plan || 'unknown';
      const url = svc.serviceDetails?.url || 'no url';

      let icon: string;
      let detail = '';
      if (status === 'live') {
        icon = '✅';
      } else if (status === 'build_failed' || status === 'update_failed') {
        icon = '❌';
        detail = ' — Service may be down.';
      } else if (status === 'build_in_progress' || status === 'update_in_progress') {
        icon = '🔄';
      } else {
        icon = '⚠️';
      }

      const logPreview = status !== 'live' ? await this.getLogPreview(svc.id) : '';

      return [
        `${icon} **${svc.name}**`,
        `   Status: \`${status}\`${detail}`,
        `   Latest: ${commitMsg}`,
        `   Finished: ${finished}`,
        `   Env: ${env} | Plan: ${plan} | ${url}`,
        logPreview ? `   Logs: ${logPreview}` : ''
      ].filter(Boolean).join('\n');
    } catch {
      return `⚠️ **${svc.name}** — Error checking service`;
    }
  }

  private async getLogPreview(serviceId: string): Promise<string> {
    try {
      const logs = await renderService.getServiceLogs(serviceId, 5);
      const lines = logs.split('\n').filter(Boolean).slice(0, 3);
      return lines.length > 0 ? lines.join('; ').slice(0, 200) : '';
    } catch {
      return '';
    }
  }

  async checkServiceByName(name: string): Promise<string> {
    try {
      const services = await renderService.getServices();
      const svc = services.find(s => s.name.toLowerCase() === name.toLowerCase());
      if (!svc) return `❌ No service named **${name}** found.`;

      await discordService.post(`🔍 Checking **${svc.name}**...`, 'Alexa');
      const result = await this.checkService(svc);
      await discordService.post(result, 'Alexa');
      return result;
    } catch (error) {
      return `❌ Error: ${(error as Error).message}`;
    }
  }

  async getLogs(serviceName: string): Promise<string> {
    try {
      const services = await renderService.getServices();
      const svc = services.find(s => s.name.toLowerCase() === serviceName.toLowerCase());
      if (!svc) return `❌ No service named **${serviceName}** found.`;

      await discordService.post(`📋 Fetching logs for **${svc.name}**...`, 'Alexa');
      const logs = await renderService.getServiceLogs(svc.id, 30);
      const formatted = `📋 **${svc.name}** logs:\n\`\`\`\n${logs.slice(0, 1900)}\n\`\`\``;
      await discordService.post(formatted, 'Alexa');
      return logs;
    } catch (error) {
      return `❌ Error: ${(error as Error).message}`;
    }
  }
}

export const serverMonitorAgent = new ServerMonitorAgent();
