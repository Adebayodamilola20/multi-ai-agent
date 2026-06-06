import { NextFunction, Request, Response } from 'express';
import { createAgentLogger } from '../../logger/logger';

const logger = createAgentLogger('server');

export function errorHandler(error: Error, req: Request, res: Response, _next: NextFunction): void {
  logger.error('Unhandled request error', {
    method: req.method,
    path: req.path,
    error: error.message,
    stack: error.stack
  });

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? undefined : error.message
  });
}
