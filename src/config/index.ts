import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development'
  },
  github: {
    token: process.env.GITHUB_TOKEN || '',
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
    username: process.env.GITHUB_USERNAME || ''
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  },
  voice: {
    enabled: process.env.VOICE_ENABLED !== 'false'
  },
  // Discord enable flag
  discordEnabled: process.env.DISCORD_ENABLED !== 'false',
  // Provider selections
  sttProvider: process.env.STT_PROVIDER || 'faster-whisper',
  ttsProvider: process.env.TTS_PROVIDER || 'macos',
  // Text input mode for testing
  textInputMode: process.env.TEXT_INPUT_MODE === 'true',
  // LLM provider flags
  useNvidia: process.env.USE_NVIDIA === 'true',
  useOllamaFallback: process.env.USE_OLLAMA_FALLBACK === 'true',
  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN || '',
    channelId: process.env.DISCORD_CHANNEL_ID || ''
  },
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN || '',
    channelId: process.env.SLACK_CHANNEL_ID || ''
  },
  email: {
    smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
    smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || '',
    to: process.env.EMAIL_TO || ''
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
  },
  nvidia: {
    apiKey: process.env.NVIDIA_API_KEY || '',
    model: process.env.NVIDIA_MODEL || 'openai/gpt-oss-120b',
    baseUrl: process.env.NVIDIA_BASE_URL || '',
    speechApiKey: process.env.PARAKEET_API_KEY || '',
    speechModel: process.env.PARAKEET_MODEL || 'parakeet-tdt-0.6b-v2'
  },
  mistral: {
    apiKey: process.env.MISTRAL_API_KEY || '',
    model: process.env.MISTRAL_MODEL || 'mistral-large-latest'
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1'
  },
  localLlm: {
    baseUrl: process.env.LOCAL_LLM_BASE_URL || 'http://localhost:11434/v1',
    model: process.env.LOCAL_LLM_MODEL || 'qwen2.5-coder:7b'
  },
  base44: {
    apiKey: process.env.BASE44_API_KEY || '',
    agentBaseUrl: process.env.BASE44_AGENT_BASE_URL || '',
    conversationId: process.env.BASE44_CONVERSATION_ID || '',
    brainProvider: process.env.BRAIN_PROVIDER || ''
  },
  queue: {
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '3', 10)
  },
  obsidian: {
    vaultPath: process.env.OBSIDIAN_VAULT_PATH || ''
  },
  render: {
    apiKey: process.env.RENDER_API_KEY || '',
    ownerId: process.env.RENDER_OWNER_ID || ''
  },
  projects: {
    basePath: process.env.PROJECTS_BASE_PATH || path.join(process.env.HOME || '/tmp', 'Desktop'),
    importedReposPath: process.env.IMPORTED_REPOS_PATH || path.join(process.env.HOME || '/tmp', 'Desktop', 'AI-Imported-Reports')
  }
};

export function validateConfig(): void {
  const required = [
    { key: 'GITHUB_TOKEN', value: config.github.token },
    { key: 'GITHUB_WEBHOOK_SECRET', value: config.github.webhookSecret },
    { key: 'DISCORD_BOT_TOKEN', value: config.discord.botToken },
    { key: 'DISCORD_CHANNEL_ID', value: config.discord.channelId },
    { key: 'SMTP_USER', value: config.email.smtpUser },
    { key: 'SMTP_PASS', value: config.email.smtpPass }
  ];

  // Add NVIDIA key requirement when enabled
  if (config.useNvidia) {
    required.push({ key: 'NVIDIA_API_KEY', value: config.nvidia.apiKey });
  }
  // Base44 validation when selected as brain provider
  if (config.base44.brainProvider?.toLowerCase() === 'base44') {
    required.push({ key: 'BASE44_API_KEY', value: config.base44.apiKey });
    required.push({ key: 'BASE44_AGENT_BASE_URL', value: config.base44.agentBaseUrl });
    required.push({ key: 'BASE44_CONVERSATION_ID', value: config.base44.conversationId });
  }
  const missing = required.filter(r => !r.value).map(r => r.key);
  if (missing.length > 0) {
    // Log which variables are missing before throwing
    const logger = require('../logger/logger').createAgentLogger('config');
    logger.error('Missing required environment variables', { missing });
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

