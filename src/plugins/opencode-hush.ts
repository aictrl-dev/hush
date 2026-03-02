/**
 * OpenCode Plugin: Hush PII Guard
 *
 * Blocks reads of sensitive files (`.env`, `*.pem`, `credentials.*`, etc.)
 * before the tool executes — the AI model never sees the content.
 *
 * Defense-in-depth: works alongside the Hush proxy which redacts PII from
 * API requests. The plugin prevents file reads; the proxy catches anything
 * that slips through in normal files.
 *
 * Install: copy to `.opencode/plugins/hush.ts` and add to `opencode.json`:
 *   { "plugin": [".opencode/plugins/hush.ts"] }
 */

import { isSensitivePath, commandReadsSensitiveFile } from './sensitive-patterns.js';

export const HushPlugin = async () => ({
  'tool.execute.before': async (
    input: { tool: string },
    output: { args: Record<string, string> },
  ) => {
    if (input.tool === 'read' && isSensitivePath(output.args['filePath'] ?? '')) {
      throw new Error('[hush] Blocked: sensitive file');
    }

    if (input.tool === 'bash' && commandReadsSensitiveFile(output.args['command'] ?? '')) {
      throw new Error('[hush] Blocked: command reads sensitive file');
    }
  },
});
