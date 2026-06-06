import { ConnectionOptions, Job, Queue, QueueEvents, Worker } from 'bullmq';
import { config } from '../config';
import { createAgentLogger } from '../logger/logger';
import { Task, TaskType } from '../types';

const logger = createAgentLogger('task-queue');

export class TaskQueue {
  private readonly connection = this.createConnectionOptions();

  readonly queue = new Queue<Task, unknown, TaskType>('multi-ai-agent-tasks', {
    connection: this.connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500
    }
  });

  readonly events = new QueueEvents('multi-ai-agent-tasks', {
    connection: this.connection
  });

  private worker?: Worker<Task, unknown, TaskType>;

  async add(task: Task): Promise<void> {
    await this.queue.add(task.type, task, {
      jobId: task.id,
      priority: task.priority
    });
    logger.info('Task enqueued', { taskId: task.id, type: task.type, priority: task.priority });
  }

  async addNext(type: TaskType, current: Task, payload: Partial<Task['payload']> = {}, priority = current.priority): Promise<Task> {
    const task: Task = {
      id: `${current.id}-${type}-${Date.now()}`,
      type,
      priority,
      payload: {
        ...current.payload,
        ...payload
      },
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.add(task);
    return task;
  }

  start(processor: (task: Task, job: Job<Task, unknown, TaskType>) => Promise<void>): void {
    if (this.worker) {
      return;
    }

    const worker = new Worker<Task, unknown, TaskType>(
      'multi-ai-agent-tasks',
      async job => {
        logger.info('Processing task', { jobId: job.id, type: job.data.type }, job.data.id);
        await processor(job.data, job);
      },
      {
        connection: this.connection,
        concurrency: config.queue.concurrency
      }
    );

    worker.on('failed', (job, error) => {
      logger.error('Task failed', { jobId: job?.id, error: error.message }, job?.data.id);
    });

    worker.on('completed', job => {
      logger.info('Task completed', { jobId: job.id, type: job.data.type }, job.data.id);
    });

    this.worker = worker;
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.events.close();
    await this.queue.close();
  }

  private createConnectionOptions(): ConnectionOptions {
    const url = new URL(config.redis.url);

    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password || undefined,
      db: url.pathname ? Number(url.pathname.replace('/', '') || 0) : 0,
      tls: url.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null
    };
  }
}

export const taskQueue = new TaskQueue();
