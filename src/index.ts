import cron from 'node-cron';
import { managerAgent } from './agents/manager.agent';
import { watcherAgent } from './agents/watcher.agent';
import { discordAgent } from './agents/discord.agent';
import { jarvisAgent } from './agents/jarvis.agent';
import { neoAgent } from './agents/neo.agent';
import { config, validateConfig } from './config';
import { createAgentLogger } from './logger/logger';
import { taskQueue } from './queue/task-queue';
import { createApp } from './server/app';

const logger = createAgentLogger('system');

async function bootstrap(): Promise<void> {
  validateConfig();

  const app = createApp();
  managerAgent.start();
  try {
    await discordAgent.start();
  } catch (error) {
    logger.error('Discord bot failed to start (server continues without it)', { error: (error as Error).message });
  }
  await jarvisAgent.start();
  await neoAgent.start();

  cron.schedule('*/60 * * * * *', () => {
    void watcherAgent.pollRepositories().catch(error => {
      logger.error('Cron polling failed', { error: (error as Error).message });
    });
  });

  const server = app.listen(config.server.port, () => {
    logger.info('Multi-AI-Agent server started', {
      port: config.server.port,
      nodeEnv: config.server.nodeEnv
    });
  });

  const shutdown = async (signal: string) => {
    logger.info('Shutdown requested', { signal });
    server.close(async () => {
      await taskQueue.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  void startJarvisLoop();
}

async function startJarvisLoop(): Promise<void> {
  while (true) {
    try {
      await jarvisAgent.listenForCommand();
    } catch (error) {
      logger.error('JARVIS loop error', { error: (error as Error).message });
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

void bootstrap().catch(error => {
  logger.error('Failed to start Multi-AI-Agent', { error: (error as Error).message, stack: (error as Error).stack });
  process.exit(1);
});
