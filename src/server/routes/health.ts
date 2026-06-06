import { Router } from 'express';
import { taskQueue } from '../../queue/task-queue';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res, next) => {
  try {
    const counts = await taskQueue.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      queue: counts
    });
  } catch (error) {
    next(error);
  }
});
