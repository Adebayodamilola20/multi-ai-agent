import { WebClient } from '@slack/web-api';
import { config } from '../config';
import { createAgentLogger } from '../logger/logger';

const logger = createAgentLogger('joe-slack');

export class SlackAgent {
  private readonly client = new WebClient(config.slack.botToken);

  async notify(message: string): Promise<void> {
    if (!config.slack.botToken || !config.slack.channelId) {
      logger.warn('Slack credentials are missing; Slack notification skipped', { message });
      return;
    }

    await this.client.chat.postMessage({
      channel: config.slack.channelId,
      text: message
    });

    logger.info('Slack notification sent');
  }
}

export const slackAgent = new SlackAgent();
