import { discordService } from '../services/discord.service';
import { createAgentLogger } from '../logger/logger';

const logger = createAgentLogger('joe-discord');

export class DiscordAgent {
  async start(): Promise<void> {
    await discordService.start();
  }

  async notify(message: string): Promise<void> {
    const agent = this.extractAgent(message);
    await discordService.post(message, agent);
    logger.info('Discord notification sent', { message });
  }

  private extractAgent(message: string): string | undefined {
    const match = message.match(/^[🟢🔵🟠🟣🔴]\s+\*\*\[?(\w+)\]?\*\*/);
    if (match) return match[1];
    const match2 = message.match(/^\*\*(\w+)\*\*/);
    if (match2) return match2[1];
    return undefined;
  }
}

export const discordAgent = new DiscordAgent();
