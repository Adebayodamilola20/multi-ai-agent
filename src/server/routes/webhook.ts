import { Router } from 'express';
import { watcherAgent } from '../../agents/watcher.agent';
import { webhookVerifier } from '../middleware/webhook-verifier';

export const webhookRouter = Router();

webhookRouter.post('/', webhookVerifier, async (req, res, next) => {
  try {
    const eventType = req.header('x-github-event');
    if (!eventType) {
      res.status(400).json({ error: 'Missing x-github-event header.' });
      return;
    }

    const task = await watcherAgent.handleWebhook(eventType, req.body);
    res.status(202).json({
      accepted: Boolean(task),
      taskId: task?.id,
      taskType: task?.type
    });
  } catch (error) {
    next(error);
  }
});
