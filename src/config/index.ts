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

  const missing = required.filter(r => !r.value).map(r => r.key);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
