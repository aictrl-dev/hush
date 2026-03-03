/**
 * OpenCode Plugin: Hush PII Guard
 *
 * 1. Blocks reads of sensitive files (`.env`, `*.pem`, `credentials.*`, etc.)
 *    before the tool executes — the AI model never sees the content.
 * 2. Redacts PII (emails, IPs, secrets) from tool arguments before execution.
 * 3. Redacts PII from tool outputs (built-in and MCP) after execution.
 *
 * Defense-in-depth: works alongside the Hush proxy which redacts PII from
 * API requests. The plugin prevents file reads and scrubs tool I/O;
 * the proxy catches anything that slips through.
 *
 * Install: copy to `.opencode/plugins/hush.ts` and add to `opencode.json`:
 *   { "plugin": [".opencode/plugins/hush.ts"] }
 */

import { isSensitivePath, commandReadsSensitiveFile } from './sensitive-patterns.js';
import { Redactor } from '../middleware/redactor.js';

const redactor = new Redactor();

export const HushPlugin = async () => ({
  'tool.execute.before': async (
    input: { tool: string },
    output: { args: Record<string, string> },
  ) => {
    // Block sensitive file reads first (hard block — throws)
    if (input.tool === 'read' && isSensitivePath(output.args['filePath'] ?? '')) {
      throw new Error('[hush] Blocked: sensitive file');
    }

    if (input.tool === 'bash' && commandReadsSensitiveFile(output.args['command'] ?? '')) {
      throw new Error('[hush] Blocked: command reads sensitive file');
    }

    // Redact PII from outbound tool arguments (in-place mutation)
    const { content, hasRedacted } = redactor.redact(output.args);
    if (hasRedacted) {
      const redacted = content as Record<string, string>;
      for (const key of Object.keys(redacted)) {
        output.args[key] = redacted[key]!;
      }
    }
  },

  'tool.execute.after': async (
    input: { tool: string },
    output: { output?: string; content?: Array<{ type: string; text?: string }> },
  ) => {
    // Built-in tools: output is a string at output.output
    if (typeof output.output === 'string') {
      const { content, hasRedacted } = redactor.redact(output.output);
      if (hasRedacted) {
        output.output = content as string;
      }
    }

    // MCP tools: output is content blocks at output.content
    if (Array.isArray(output.content)) {
      for (const block of output.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          const { content, hasRedacted } = redactor.redact(block.text);
          if (hasRedacted) {
            block.text = content as string;
          }
        }
      }
    }
  },
});
