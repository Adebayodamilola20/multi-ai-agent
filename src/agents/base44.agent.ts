import { Base44Service } from '../services/base44.service';
import { createAgentLogger } from '../logger/logger';

/**
 * Base44Agent – thin wrapper around Base44Service that fits the existing agent pattern.
 * It receives the full conversation history but currently forwards only the latest user
 * message to the Base44 endpoint (the API only accepts a single message). The response
 * string is returned to the caller.
 */
export class Base44Agent {
  private logger = createAgentLogger('base44');
  private service = new Base44Service();

  /** Return the assistant reply for the given conversation */
  async getResponse(conversation: { role: string; content: string }[]): Promise<string> {
    // Find the most recent user message – Base44 expects a single input.
    const lastUser = conversation.filter(m => m.role === 'user').slice(-1)[0];
    if (!lastUser) {
      this.logger.warn('No user message found in conversation');
      return '';
    }
    this.logger.info('Sending message to Base44', { length: lastUser.content.length });
    const reply = await this.service.sendMessage(lastUser.content);
    return reply;
  }
}

export const base44Agent = new Base44Agent();
