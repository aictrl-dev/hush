#!/usr/bin/env node
import { app } from './index.js';
import { createLogger } from './lib/logger.js';

const log = createLogger('hush-cli');
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  log.info(`Hush Semantic Gateway is listening on http://localhost:${PORT}`);
  log.info(`To use with Claude Code: export ANTHROPIC_BASE_URL=http://localhost:${PORT}`);
});
