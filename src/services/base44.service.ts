// Base44 Service – handles communication with the Base44 LLM API
// The service sends a user message to the configured Base44 endpoint and returns the assistant reply.
// Environment variables required:
//   BASE44_API_KEY – API key for authentication (sent as "api_key" header)
//   BASE44_AGENT_BASE_URL – Base URL for the Base44 agent (e.g., https://api.base44.ai)
//   BASE44_CONVERSATION_ID – Conversation identifier used in the request path

import { config } from '../config';
import { createAgentLogger } from '../logger/logger';

const logger = createAgentLogger('base44-service');

export class Base44Service {
  /** Send a single user message to Base44 and return the assistant's content */
  async sendMessage(message: string): Promise<string> {
    const { apiKey, agentBaseUrl, conversationId } = config.base44;
    const missing: string[] = [];
    if (!apiKey) missing.push('BASE44_API_KEY');
    if (!agentBaseUrl) missing.push('BASE44_AGENT_BASE_URL');
    if (!conversationId) missing.push('BASE44_CONVERSATION_ID');
    if (missing.length) {
      logger.error('Base44 configuration missing', { missing });
      throw new Error(`Base44 configuration missing – ensure ${missing.join(', ')} are set`);
    }
    const endpoint = `${agentBaseUrl.replace(/\/+$/, '')}/conversations/${conversationId}/messages`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role: 'user', content: message })
    });
    if (!response.ok) {
      const txt = await response.text();
      logger.error('Base44 API error', { status: response.status, body: txt });
      throw new Error(`Base44 API error ${response.status}: ${txt}`);
    }
const data = await response.json() as any;
      return (data as any)?.content ?? '';
  }
}
