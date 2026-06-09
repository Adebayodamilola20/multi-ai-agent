import cron from 'node-cron';
import { managerAgent } from './agents/manager.agent';
import { watcherAgent } from './agents/watcher.agent';
import { discordAgent } from './agents/discord.agent';
import { voiceAgent } from './agents/voice.agent';
import { neoAgent } from './agents/neo.agent';
import { config, validateConfig } from './config';
import { createAgentLogger } from './logger/logger';
import { taskQueue } from './queue/task-queue';
import { createApp } from './server/app';

const logger = createAgentLogger('system');

async function bootstrap(): Promise<void> {
  validateConfig();

  // Log selected providers at startup
    logger.info('Provider configuration', {
      llmProvider: config.useNvidia ? 'NVIDIA' : config.useOllamaFallback ? 'Ollama' : 'none',
      sttProvider: config.sttProvider,
      ttsProvider: config.ttsProvider,
      brainProvider: config.base44.brainProvider || 'base44'
    });
    if (config.base44.brainProvider?.toLowerCase() === 'base44') {
      logger.info('Base44 configuration loaded', {
        brainProvider: config.base44.brainProvider,
        baseUrl: config.base44.agentBaseUrl ? 'configured' : 'missing',
        conversationId: config.base44.conversationId ? 'configured' : 'missing',
        apiKey: config.base44.apiKey ? 'configured' : 'missing'
      });
    }


  const app = createApp();
  managerAgent.start();
  if (config.discordEnabled) {
    try {
      await discordAgent.start();
    } catch (error) {
      logger.error('Discord bot failed to start (server continues without it)', { error: (error as Error).message });
    }
  }
  await voiceAgent.start();
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

  void startVoiceLoop();
}

async function startVoiceLoop(): Promise<void> {
  while (true) {
    try {
      await voiceAgent.runCycle();
    } catch (error) {
      logger.error('Voice loop error', { error: (error as Error).message });
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

void bootstrap().catch(error => {
  logger.error('Failed to start Multi-AI-Agent', { error: (error as Error).message, stack: (error as Error).stack });
  process.exit(1);
});
