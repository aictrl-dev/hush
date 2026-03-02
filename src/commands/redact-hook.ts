/**
 * hush redact-hook — Claude Code PostToolUse hook handler
 *
 * Reads the hook payload from stdin, redacts PII from tool output,
 * and prints a hookSpecificOutput override if anything was redacted.
 *
 * Exit codes:
 *   0 — success (output may or may not contain override)
 *   2 — malformed input (blocks the tool call per hooks spec)
 */

import { Redactor } from '../middleware/redactor.js';

interface HookPayload {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: {
    // Bash tool
    stdout?: string;
    stderr?: string;
    // Read / Grep / WebFetch tools
    content?: string;
    // Generic fallback
    output?: string;
    [key: string]: unknown;
  };
}

interface HookResponse {
  hookSpecificOutput: {
    hookEventName: 'PostToolUse';
    outputOverride: string;
  };
}

/** Collect all text from a tool_output object. */
function extractText(toolOutput: HookPayload['tool_output']): string | null {
  if (!toolOutput || typeof toolOutput !== 'object') return null;

  const parts: string[] = [];

  if (typeof toolOutput.stdout === 'string' && toolOutput.stdout) {
    parts.push(toolOutput.stdout);
  }
  if (typeof toolOutput.stderr === 'string' && toolOutput.stderr) {
    parts.push(toolOutput.stderr);
  }
  if (typeof toolOutput.content === 'string' && toolOutput.content) {
    parts.push(toolOutput.content);
  }
  if (typeof toolOutput.output === 'string' && toolOutput.output) {
    parts.push(toolOutput.output);
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

/** Build the redacted tool_output, preserving the original shape. */
function redactToolOutput(
  toolOutput: NonNullable<HookPayload['tool_output']>,
  redactor: Redactor,
): { text: string; hasRedacted: boolean } {
  const text = extractText(toolOutput);
  if (!text) return { text: '', hasRedacted: false };

  const { content, hasRedacted } = redactor.redact(text);
  return { text: content as string, hasRedacted };
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

export async function run(): Promise<void> {
  let raw: string;
  try {
    raw = await readStdin();
  } catch {
    process.stderr.write('hush redact-hook: failed to read stdin\n');
    process.exit(2);
  }

  if (!raw.trim()) {
    // Empty stdin — nothing to redact
    process.exit(0);
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(raw) as HookPayload;
  } catch {
    process.stderr.write('hush redact-hook: invalid JSON on stdin\n');
    process.exit(2);
  }

  if (!payload.tool_output) {
    // No tool_output to redact
    process.exit(0);
  }

  const redactor = new Redactor();
  const { text, hasRedacted } = redactToolOutput(payload.tool_output, redactor);

  if (!hasRedacted) {
    // No PII found — let Claude Code keep the original output
    process.exit(0);
  }

  const response: HookResponse = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      outputOverride: text,
    },
  };

  process.stdout.write(JSON.stringify(response) + '\n');
  process.exit(0);
}
