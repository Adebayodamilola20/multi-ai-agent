import OpenAI from 'openai';
import { config } from '../config';
import { createAgentLogger } from '../logger/logger';

const logger = createAgentLogger('llm-service');

export class LlmService {
  private client: OpenAI;

  private provider: 'nvidia' | 'ollama' | 'none' = 'none';
  constructor() {
    // Disable NVIDIA LLM when Base44 brain provider is selected
    if (config.useNvidia && (!config.base44 || config.base44.brainProvider?.toLowerCase() !== 'base44')) {
if (!config.nvidia.apiKey) {
        logger.error('USE_NVIDIA is true but NVIDIA_API_KEY is missing – LLM provider disabled');
        this.provider = 'none';
        // create dummy client to satisfy TypeScript
        this.client = new OpenAI({
          baseURL: '',
          apiKey: ''
        });
      } else {
        // NVIDIA provider
        this.client = new OpenAI({
          baseURL: config.nvidia.baseUrl,
          apiKey: config.nvidia.apiKey
        });
        this.provider = 'nvidia';
        logger.info('NVIDIA LLM client initialized', {
          model: config.nvidia.model,
          provider: 'NVIDIA',
          baseUrl: config.nvidia.baseUrl
        });
        // Log API key presence without revealing it
        logger.info('NVIDIA_API_KEY loaded: true');
      }
    } else if (config.useOllamaFallback) {
      // Ollama fallback
      this.client = new OpenAI({
        baseURL: config.localLlm.baseUrl,
        apiKey: 'ollama'
      });
      this.provider = 'ollama';
      logger.info('Ollama LLM client initialized', {
        baseUrl: config.localLlm.baseUrl,
        model: config.localLlm.model
      });
    } else {
      // No LLM provider enabled
      this.provider = 'none';
      logger.warn('No LLM provider configured – LLM services disabled');
      // Create a dummy client to avoid null checks; will throw on usage
      this.client = new OpenAI({
        baseURL: '',
        apiKey: ''
      });
    }
  }

  getClient(): OpenAI {
    return this.client;
  }

  getModel(): string {
    if (this.provider === 'nvidia') {
      return config.nvidia.model;
    }
    if (this.provider === 'ollama') {
      return config.localLlm.model;
    }
    return '';
  }

  /** Stream chat completions and invoke callback for each token */
  async streamChat(messages: { role: string; content: string }[], onToken: (token: string) => void): Promise<void> {
    const model = this.getModel();
    const stream = await this.client.chat.completions.create({
      model,
      messages: messages as any, // OpenAI typings accept ChatCompletionMessageParam[]; cast for simplicity
      stream: true
    });
    for await (const part of stream) {
      const delta = (part as any).choices?.[0]?.delta?.content;
      if (delta) onToken(delta);
    }
  }

}

export const llmService = new LlmService();
