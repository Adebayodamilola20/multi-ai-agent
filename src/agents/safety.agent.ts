import { createAgentLogger } from '../logger/logger';
import { discordService } from '../services/discord.service';

/**
 * Central safety gate for any potentially risky operation.
 * Currently a stub – it logs the request and auto‑approves.
 * Future implementation can post a Discord message and await a reaction or UI confirmation.
 */
export class SafetyAgent {
  private logger = createAgentLogger('safety');

  /** Request confirmation before performing a risky action */
  async confirm(actionDescription: string): Promise<boolean> {
    this.logger.info('Safety confirmation requested', { action: actionDescription });
    // Post to Discord for traceability (auto‑approve for now)
    await discordService.post(`⚠️ Safety check: ${actionDescription}\n(Automatically approved for now)`, 'Jarvis');
    return true; // auto‑approve – replace with real user prompt later
  }
}

export const safetyAgent = new SafetyAgent();
