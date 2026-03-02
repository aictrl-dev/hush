/**
 * hush redact-hook — Claude Code PreToolUse / PostToolUse hook handler
 *
 * Reads the hook payload from stdin, redacts PII, and returns the
 * appropriate response format depending on the hook event type:
 *
 *   PreToolUse  — redacts outbound MCP tool arguments (updatedInput)
 *   PostToolUse — redacts inbound MCP tool results  (updatedMCPToolOutput)
 *                 or blocks built-in tool output     (decision: "block")
 *
 * Exit codes:
 *   0 — success (may or may not redact)
 *   2 — malformed input (blocks the tool call per hooks spec)
 */

import { Redactor } from '../middleware/redactor.js';

interface MCPContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface HookPayload {
  hook_event_name?: 'PreToolUse' | 'PostToolUse';
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: {
    // Bash tool
    stdout?: string;
    stderr?: string;
    // Read tool (nested under file)
    file?: { content?: string; [key: string]: unknown };
    // Grep / WebFetch / generic
    content?: string | MCPContentBlock[];
    output?: string;
    [key: string]: unknown;
  };
}

/** Collect all text from a built-in tool_response object. */
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

/** Redact PII from a built-in tool response text. */
function redactBuiltinToolResponse(
  toolResponse: NonNullable<HookPayload['tool_response']>,
  redactor: Redactor,
): { text: string; hasRedacted: boolean } {
  const text = extractText(toolResponse);
  if (!text) return { text: '', hasRedacted: false };

  const { content, hasRedacted } = redactor.redact(text);
  return { text: content as string, hasRedacted };
}

/** Handle PreToolUse — redact outbound MCP tool arguments. */
function handlePreToolUse(payload: HookPayload, redactor: Redactor): void {
  if (!payload.tool_input || typeof payload.tool_input !== 'object') {
    process.exit(0);
  }

  const { content, hasRedacted } = redactor.redact(payload.tool_input);

  if (!hasRedacted) {
    process.exit(0);
  }

  const response = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: content,
    },
  };

  process.stdout.write(JSON.stringify(response) + '\n');
  process.exit(0);
}

/** Handle PostToolUse for MCP tools — redact inbound content blocks. */
function handlePostToolUseMCP(payload: HookPayload, redactor: Redactor): void {
  const toolResponse = payload.tool_response;
  if (!toolResponse || typeof toolResponse !== 'object') {
    process.exit(0);
  }

  const contentArray = toolResponse.content;
  if (!Array.isArray(contentArray)) {
    process.exit(0);
  }

  const { content: redactedArray, hasRedacted } = redactor.redact(contentArray);

  if (!hasRedacted) {
    process.exit(0);
  }

  const response = {
    updatedMCPToolOutput: {
      content: redactedArray,
    },
  };

  process.stdout.write(JSON.stringify(response) + '\n');
  process.exit(0);
}

/** Handle PostToolUse for built-in tools — existing block/reason flow. */
function handlePostToolUseBuiltin(payload: HookPayload, redactor: Redactor): void {
  if (!payload.tool_response) {
    process.exit(0);
  }

  const { text, hasRedacted } = redactBuiltinToolResponse(payload.tool_response, redactor);

  if (!hasRedacted) {
    process.exit(0);
  }

  const response = {
    decision: 'block' as const,
    reason: text,
  };

  process.stdout.write(JSON.stringify(response) + '\n');
  process.exit(0);
}

function isMCPTool(toolName?: string): boolean {
  return typeof toolName === 'string' && toolName.startsWith('mcp__');
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
    process.exit(0);
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(raw) as HookPayload;
  } catch {
    process.stderr.write('hush redact-hook: invalid JSON on stdin\n');
    process.exit(2);
  }

  const redactor = new Redactor();
  const eventName = payload.hook_event_name;

  if (eventName === 'PreToolUse') {
    handlePreToolUse(payload, redactor);
    return;
  }

  if (eventName === 'PostToolUse') {
    if (isMCPTool(payload.tool_name)) {
      handlePostToolUseMCP(payload, redactor);
    } else {
      handlePostToolUseBuiltin(payload, redactor);
    }
    return;
  }

  // Backward compat: no hook_event_name → treat as PostToolUse built-in
  handlePostToolUseBuiltin(payload, redactor);
}
