import { createHmac, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { config } from '../../config';

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

export function webhookVerifier(req: RawBodyRequest, res: Response, next: NextFunction): void {
  if (!config.github.webhookSecret) {
    res.status(500).json({ error: 'GitHub webhook secret is not configured.' });
    return;
  }

  const signature = req.header('x-hub-signature-256');
  if (!signature) {
    res.status(401).json({ error: 'Missing GitHub webhook signature.' });
    return;
  }

  const rawBody = req.rawBody;
  if (!rawBody) {
    res.status(400).json({ error: 'Missing raw request body for signature verification.' });
    return;
  }

  const expected = `sha256=${createHmac('sha256', config.github.webhookSecret).update(rawBody).digest('hex')}`;
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) {
    res.status(401).json({ error: 'Invalid GitHub webhook signature.' });
    return;
  }

  next();
}
