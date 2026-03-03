/**
 * OpenClaw Skill: Hush PII Guard
 *
 * 1. Blocks reads of sensitive files (`.env`, `*.pem`, `credentials.*`, etc.)
 *    before the tool executes — the AI model never sees the content.
 * 2. Redacts PII (emails, IPs, secrets) from tool outputs (stdout/stderr)
 *    before the AI model sees the result.
 *
 * Defense-in-depth: works alongside the Hush proxy which redacts PII from
 * API requests. The skill protects your local machine; the proxy protects the cloud.
 *
 * Install:
 *   Copy this file to `~/.openclaw/workspace/skills/hush/index.ts`
 *   and create a `SKILL.md` in the same directory.
 */

import { isSensitivePath, commandReadsSensitiveFile } from './sensitive-patterns.js';
import { Redactor } from '../middleware/redactor.js';

const redactor = new Redactor();

export const HushSkill = async () => ({
  /**
   * Pre-execution: Block dangerous file access.
   */
  'before_tool_call': async (
    event: { toolName: string; params: Record<string, any> },
  ) => {
    // Block read tool if targeting sensitive files
    if (event.toolName === 'read' && isSensitivePath(event.params['filePath'] ?? '')) {
      return { block: true, blockReason: '[hush] Blocked: sensitive file' };
    }

    // Block bash tool if command reads sensitive files (cat .env, etc.)
    if (event.toolName === 'bash' && commandReadsSensitiveFile(event.params['command'] ?? '')) {
      return { block: true, blockReason: '[hush] Blocked: command reads sensitive file' };
    }
  },

  /**
   * Post-execution: Redact PII from tool outputs before OpenClaw sees them.
   */
  'after_tool_call': async (
    event: { 
      toolName: string; 
      params: Record<string, any>;
      result?: any;
    },
  ) => {
    if (!event.result || typeof event.result !== 'object') return;

    const output = event.result;

    const redactSafely = (val: any): string | any => {
      if (typeof val !== 'string') return val;
      try {
        const { content } = redactor.redact(val);
        return typeof content === 'string' ? content : val;
      } catch (err) {
        // Fallback: return original content if redaction fails to avoid data loss
        return val;
      }
    };

    // 1. Scan stdout/stderr (Bash tool)
    if (output.stdout) {
      output.stdout = redactSafely(output.stdout);
    }
    if (output.stderr) {
      output.stderr = redactSafely(output.stderr);
    }

    // 2. Scan file content (Read tool)
    if (output.file && typeof output.file.content === 'string') {
      output.file.content = redactSafely(output.file.content);
    }

    // 3. Scan generic content/output
    if (typeof output.content === 'string') {
      output.content = redactSafely(output.content);
    }
  },
});
