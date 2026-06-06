import { createAgentLogger } from '../logger/logger';
import { obsidianService } from '../services/obsidian.service';
import { taskQueue } from '../queue/task-queue';
import { Task } from '../types';

const logger = createAgentLogger('neo');

export class NeoAgent {
  async start(): Promise<void> {
    await obsidianService.init();
    if (!process.env.OBSIDIAN_VAULT_PATH) {
      logger.info('Obsidian vault not configured — Neo sleeping');
      return;
    }

    const handler = async (event: 'started' | 'completed' | 'failed', jobId: string, detail?: string) => {
      const job = await taskQueue.queue.getJob(jobId);
      if (job?.data) {
        await obsidianService.logTaskEvent(job.data, event, detail);
      }
    };

    taskQueue.events.on('active', ({ jobId }) => {
      void handler('started', jobId);
    });

    taskQueue.events.on('completed', ({ jobId }) => {
      void handler('completed', jobId);
    });

    taskQueue.events.on('failed', ({ jobId, failedReason }) => {
      void handler('failed', jobId, failedReason);
    });

    logger.info('Neo agent started — watching queue for Obsidian sync');
  }
}

export const neoAgent = new NeoAgent();
