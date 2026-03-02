/**
 * hush redact-hook — Claude Code PostToolUse hook handler
 *
 * Reads the hook payload from stdin, redacts PII from the tool response,
 * and blocks the output (replacing it with redacted text) if PII was found.
 *
 * Exit codes:
 *   0 — success (may or may not block)
 *   2 — malformed input (blocks the tool call per hooks spec)
 */

import { Redactor } from '../middleware/redactor.js';

interface HookPayload {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: {
    // Bash tool
    stdout?: string;
    stderr?: string;
    // Read tool (nested under file)
    file?: { content?: string; [key: string]: unknown };
    // Grep / WebFetch / generic
    content?: string;
    output?: string;
    [key: string]: unknown;
  };
}

interface HookResponse {
  decision: 'block';
  reason: string;
}

/** Collect all text from a tool_response object. */
function extractText(toolResponse: HookPayload['tool_response']): string | null {
  if (!toolResponse || typeof toolResponse !== 'object') return null;

  const parts: string[] = [];

  if (typeof toolResponse.stdout === 'string' && toolResponse.stdout) {
    parts.push(toolResponse.stdout);
  }
  if (typeof toolResponse.stderr === 'string' && toolResponse.stderr) {
    parts.push(toolResponse.stderr);
  }
  // Read tool nests content under file.content
  if (toolResponse.file && typeof toolResponse.file.content === 'string' && toolResponse.file.content) {
    parts.push(toolResponse.file.content);
  }
  if (typeof toolResponse.content === 'string' && toolResponse.content) {
    parts.push(toolResponse.content);
  }
  if (typeof toolResponse.output === 'string' && toolResponse.output) {
    parts.push(toolResponse.output);
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

/** Redact PII from the tool response text. */
function redactToolResponse(
  toolResponse: NonNullable<HookPayload['tool_response']>,
  redactor: Redactor,
): { text: string; hasRedacted: boolean } {
  const text = extractText(toolResponse);
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

  if (!payload.tool_response) {
    // No tool_response to redact
    process.exit(0);
  }

  const redactor = new Redactor();
  const { text, hasRedacted } = redactToolResponse(payload.tool_response, redactor);

  if (!hasRedacted) {
    // No PII found — let Claude Code keep the original output
    process.exit(0);
  }

  const response: HookResponse = {
    decision: 'block',
    reason: text,
  };

  process.stdout.write(JSON.stringify(response) + '\n');
  process.exit(0);
}
