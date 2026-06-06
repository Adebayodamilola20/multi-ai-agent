import express from 'express';
import rateLimit from 'express-rate-limit';
import { errorHandler } from './middleware/error-handler';
import { healthRouter } from './routes/health';
import { webhookRouter } from './routes/webhook';
import { RawBodyRequest } from './middleware/webhook-verifier';

export function createApp() {
  const app = express();

  app.use(
    express.json({
      limit: '10mb',
      verify: (req: RawBodyRequest, _res, buf) => {
        req.rawBody = Buffer.from(buf);
      }
    })
  );

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false
    })
  );

  app.get('/', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Multi-AI-Agent</title>
    <style>
      body { margin: 0; font-family: Arial, sans-serif; background: #0f172a; color: #e5e7eb; }
      main { max-width: 860px; margin: 0 auto; padding: 48px 24px; }
      h1 { margin: 0 0 8px; font-size: 36px; }
      h2 { margin-top: 32px; font-size: 20px; }
      code, pre { background: #111827; border: 1px solid #334155; border-radius: 6px; color: #f8fafc; }
      code { padding: 2px 6px; }
      pre { padding: 16px; overflow-x: auto; }
      a { color: #38bdf8; }
      .status { display: inline-block; margin: 16px 0; padding: 8px 12px; border-radius: 999px; background: #14532d; color: #dcfce7; }
      li { margin: 8px 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>Multi-AI-Agent</h1>
      <div class="status">Server running</div>
      <p>This is an API and worker service. There is no dashboard yet; use Discord commands or GitHub webhooks.</p>

      <h2>Open These</h2>
      <ul>
        <li><a href="/health">/health</a> - service and queue health</li>
        <li><a href="/api/health">/api/health</a> - same health endpoint under API path</li>
      </ul>

      <h2>Discord Commands</h2>
      <pre>Tom health
Tom check owner/repo
Tom check owner/repo main</pre>

      <h2>GitHub Webhook</h2>
      <p>Configure your GitHub repository webhook URL to:</p>
      <pre>POST http://YOUR_PUBLIC_URL/api/webhook</pre>
      <p>Use the same secret as <code>GITHUB_WEBHOOK_SECRET</code>.</p>
    </main>
  </body>
</html>`);
  });

  app.use('/health', healthRouter);
  app.use('/api/health', healthRouter);
  app.use('/api/webhook', webhookRouter);
  app.use(errorHandler);

  return app;
}
