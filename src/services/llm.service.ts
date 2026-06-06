import OpenAI from 'openai';
import { config } from '../config';
import { createAgentLogger } from '../logger/logger';

const logger = createAgentLogger('llm-service');

export class LlmService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      baseURL: config.localLlm.baseUrl,
      apiKey: 'ollama'
    });
    logger.info('Local LLM client initialized', {
      baseUrl: config.localLlm.baseUrl,
      model: config.localLlm.model
    });
  }

  getClient(): OpenAI {
    return this.client;
  }

  getModel(): string {
    return config.localLlm.model;
  }

}

export const llmService = new LlmService();
