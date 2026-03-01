#!/usr/bin/env node
import { app } from './index.js';
import { createLogger } from './lib/logger.js';

const log = createLogger('hush-cli');
const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
  log.info(`Hush Semantic Gateway is listening on http://localhost:${PORT}`);
  log.info(`Routes: /v1/messages → Anthropic, /v1/chat/completions → OpenAI, /api/paas/v4/** → ZhipuAI, * → Google`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log.error(`Port ${PORT} is already in use. Stop the other process or use PORT=<number> hush`);
  } else {
    log.error({ err }, 'Failed to start server');
  }
  process.exit(1);
});
