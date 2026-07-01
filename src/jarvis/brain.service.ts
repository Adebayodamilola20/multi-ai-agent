import OpenAI from 'openai';
import { createAgentLogger } from '../logger/logger';

const logger = createAgentLogger('brain');

/**
 * BrainService — pluggable LLM provider.
 *
 * Every supported provider exposes an OpenAI-compatible Chat Completions API,
 * so we can talk to all of them with the official `openai` SDK by swapping the
 * baseURL + apiKey + model. Selection is driven entirely by env:
 *
 *   BRAIN_PROVIDER=nvidia | openrouter | gemini | ollama | openai
 *
 * This is intentionally decoupled from the legacy llm.service / Base44 wiring.
 */

export type BrainProvider = 'nvidia' | 'openrouter' | 'gemini' | 'ollama' | 'openai';

interface ProviderConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

function resolveProvider(): { provider: BrainProvider; cfg: ProviderConfig } {
  const provider = (process.env.BRAIN_PROVIDER || 'nvidia').toLowerCase() as BrainProvider;

  switch (provider) {
    case 'nvidia':
      return {
        provider,
        cfg: {
          baseURL: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
          apiKey: process.env.NVIDIA_API_KEY || '',
          model: process.env.NVIDIA_MODEL || 'openai/gpt-oss-120b'
        }
      };

    case 'openrouter':
      return {
        provider,
        cfg: {
          baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
          apiKey: process.env.OPENROUTER_API_KEY || '',
          model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini'
        }
      };

    case 'gemini':
      // Google exposes an OpenAI-compatible endpoint.
      return {
        provider,
        cfg: {
          baseURL: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
          apiKey: process.env.GEMINI_API_KEY || '',
          model: process.env.GEMINI_MODEL || 'gemini-2.0-flash'
        }
      };

    case 'ollama':
      return {
        provider,
        cfg: {
          baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
          apiKey: 'ollama', // Ollama ignores the key but the SDK requires a non-empty value
          model: process.env.OLLAMA_MODEL || 'llama3.1'
        }
      };

    case 'openai':
    default:
      return {
        provider: 'openai',
        cfg: {
          baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
          apiKey: process.env.OPENAI_API_KEY || '',
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
        }
      };
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const PERSONALITY = [
  'You are Jarvis, a personal AI assistant for Stephen on macOS.',
  'Personality: short, calm, intelligent, direct, and slightly witty. Never verbose.',
  'Rules:',
  '- Answer in 1-3 sentences. No essays, no bullet lists unless explicitly asked.',
  '- Speak plainly. You are spoken aloud, so avoid markdown, code blocks, and emoji.',
  '- Address the user as Stephen when natural, not every time.',
  '- If you do not know, say so briefly.'
].join('\n');

export class BrainService {
  private client: OpenAI;
  readonly provider: BrainProvider;
  readonly model: string;
  private readonly hasKey: boolean;

  constructor() {
    const { provider, cfg } = resolveProvider();
    this.provider = provider;
    this.model = cfg.model;
    this.hasKey = Boolean(cfg.apiKey);

    this.client = new OpenAI({
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey || 'missing'
    });

    logger.info('Brain initialized', {
      provider,
      model: cfg.model,
      baseURL: cfg.baseURL,
      apiKey: this.hasKey ? 'configured' : 'MISSING'
    });

    if (!this.hasKey && provider !== 'ollama') {
      logger.warn(`No API key for provider "${provider}". Set the matching *_API_KEY in .env.`);
    }
  }

  /**
   * Ask the brain a question and get a short spoken-style reply.
   * `history` lets the caller supply prior turns for context.
   */
  async ask(prompt: string, history: ChatMessage[] = []): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: PERSONALITY },
      ...history,
      { role: 'user', content: prompt }
    ];

    logger.info('LLM request started', { provider: this.provider, model: this.model });
    const started = Date.now();

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.5,
        // Reasoning models (e.g. gpt-oss) spend tokens "thinking" before the
        // visible answer; too small a budget yields empty content.
        max_tokens: 800,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[]
      });

      const reply = response.choices[0]?.message?.content?.trim() || 'I have nothing to add.';
      logger.info('LLM response received', { ms: Date.now() - started, chars: reply.length });
      return reply;
    } catch (error) {
      logger.error('LLM request failed', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Run a custom message list and return raw JSON text. Used by the
   * CommandRouter's planner to turn fuzzy phrasing into a structured action.
   */
  async completeJSON(messages: ChatMessage[]): Promise<string> {
    logger.info('LLM plan request started', { provider: this.provider, model: this.model });
    const started = Date.now();
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      // Headroom for reasoning tokens so the JSON content isn't truncated away.
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[]
    });
    logger.info('LLM plan received', { ms: Date.now() - started, finish: response.choices[0]?.finish_reason });
    return response.choices[0]?.message?.content?.trim() || '{}';
  }
}

export const brainService = new BrainService();
