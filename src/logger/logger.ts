import winston from 'winston';
import winstonDailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, agent, taskId, message, metadata }) => {
    const meta = metadata ? JSON.stringify(metadata) : '';
    return `${timestamp} [${level.toUpperCase()}] [${agent || 'system'}]${taskId ? ` [task:${taskId}]` : ''} ${message} ${meta}`;
  })
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, agent, taskId, message, metadata }) => {
    const meta = metadata ? JSON.stringify(metadata) : '';
    return `${timestamp} [${level}] [${agent || 'system'}]${taskId ? ` [task:${taskId}]` : ''} ${message} ${meta}`;
  })
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: consoleFormat,
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
  })
];

if (process.env.NODE_ENV === 'production') {
  transports.push(
    new winstonDailyRotateFile({
      filename: path.join('logs', 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      maxSize: '20m',
      format: logFormat,
      level: 'info'
    }),
    new winstonDailyRotateFile({
      filename: path.join('logs', 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      maxSize: '20m',
      format: logFormat,
      level: 'error'
    })
  );
}

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: logFormat,
  transports,
  defaultMeta: { agent: 'system' }
});

export function createAgentLogger(agent: string) {
  return {
    error: (message: string, metadata?: Record<string, unknown>, taskId?: string) =>
      logger.error(message, { agent, taskId, metadata }),
    warn: (message: string, metadata?: Record<string, unknown>, taskId?: string) =>
      logger.warn(message, { agent, taskId, metadata }),
    info: (message: string, metadata?: Record<string, unknown>, taskId?: string) =>
      logger.info(message, { agent, taskId, metadata }),
    debug: (message: string, metadata?: Record<string, unknown>, taskId?: string) =>
      logger.debug(message, { agent, taskId, metadata })
  };
}