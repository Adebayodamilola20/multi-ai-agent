import { createAgentLogger } from '../logger/logger';
import { discordService } from '../services/discord.service';
import { renderService } from '../services/render.service';

const logger = createAgentLogger('devops');

export class DevOpsAgent {
  async redeploy(serviceName: string): Promise<string> {
    await discordService.post(`🔄 Triggering redeploy for **${serviceName}**...`, 'Alexa');

    try {
      const services = await renderService.getServices();
      const svc = services.find(s => s.name.toLowerCase() === serviceName.toLowerCase());
      if (!svc) {
        await discordService.post(`❌ No service named **${serviceName}** found.`, 'Alexa');
        return `Service ${serviceName} not found`;
      }

      const lastDeploy = await renderService.getLatestDeploy(svc.id);
      if (lastDeploy?.status === 'build_in_progress' || lastDeploy?.status === 'update_in_progress') {
        await discordService.post(`⚠️ **${svc.name}** already has a deploy in progress. Wait for it to finish.`, 'Alexa');
        return 'Deploy already in progress';
      }

      const deploy = await renderService.triggerDeploy(svc.id);
      await discordService.post(
        `✅ Redeploy triggered for **${svc.name}**!\n   Deploy ID: \`${deploy.id}\`\n   Commit: ${deploy.commit?.message?.slice(0, 80) || 'N/A'}\n   Status: ${deploy.status}`,
        'Alexa'
      );
      return deploy.id;
    } catch (error) {
      const msg = `❌ Redeploy failed: ${(error as Error).message}`;
      await discordService.post(msg, 'Alexa');
      return msg;
    }
  }

  async checkLogs(serviceName: string): Promise<string> {
    await discordService.post(`📋 Fetching logs for **${serviceName}**...`, 'Alexa');

    try {
      const services = await renderService.getServices();
      const svc = services.find(s => s.name.toLowerCase() === serviceName.toLowerCase());
      if (!svc) {
        await discordService.post(`❌ No service named **${serviceName}** found.`, 'Alexa');
        return 'Service not found';
      }

      const deploy = await renderService.getLatestDeploy(svc.id);
      if (!deploy) {
        await discordService.post(`No deploys found for **${svc.name}**.`, 'Alexa');
        return 'No deploys';
      }

      const status = deploy.status;
      const failed = status === 'build_failed' || status === 'update_failed';

      if (failed) {
        const logs = await renderService.getServiceLogs(svc.id, 50);
        const logSnippet = logs.slice(0, 1500);
        await discordService.post(
          `❌ **${svc.name}** latest deploy failed.\n   Status: \`${status}\`\n   Commit: ${deploy.commit?.message?.slice(0, 60) || 'N/A'}\n\n\`\`\`${logSnippet}\n\`\`\``,
          'Alexa'
        );
        return logSnippet;
      }

      await discordService.post(`✅ **${svc.name}** is healthy.\n   Status: \`${status}\``, 'Alexa');
      return `Service ${svc.name} is ${status}`;
    } catch (error) {
      const msg = `❌ Log check failed: ${(error as Error).message}`;
      await discordService.post(msg, 'Alexa');
      return msg;
    }
  }
}

export const devOpsAgent = new DevOpsAgent();
