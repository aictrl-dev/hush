/**
 * hush redact-hook — Hook handler for Claude Code and Gemini CLI
 *
 * Reads the hook payload from stdin, redacts PII, and returns the
 * appropriate response format depending on the hook event type:
 *
 *   Claude Code:
 *     PreToolUse  — redacts outbound MCP tool arguments (updatedInput)
 *     PostToolUse — redacts inbound MCP tool results  (updatedMCPToolOutput)
 *                   or blocks built-in tool output     (decision: "block")
 *
 *   Gemini CLI:
 *     BeforeTool  — redacts outbound MCP tool arguments (hookSpecificOutput.tool_input)
 *     AfterTool   — redacts inbound tool results        (decision: "deny")
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
  hook_event_name?: 'PreToolUse' | 'PostToolUse' | 'BeforeTool' | 'AfterTool';
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

// ── Shared helpers ──────────────────────────────────────────────────────

/**
 * Redact PII from tool_input and format the response.
 * Shared by PreToolUse (Claude) and BeforeTool (Gemini).
 */
function redactToolInput(
  payload: HookPayload,
  redactor: Redactor,
  formatResponse: (redactedInput: Record<string, unknown>) => object,
): void {
  if (!payload.tool_input || typeof payload.tool_input !== 'object') {
    process.exit(0);
  }

  const { content, hasRedacted } = redactor.redact(payload.tool_input);

  if (!hasRedacted) {
    process.exit(0);
  }

  const response = formatResponse(content as Record<string, unknown>);
  process.stdout.write(JSON.stringify(response) + '\n');
  process.exit(0);
}

/**
 * Redact PII from a built-in tool response and format the response.
 * Shared by PostToolUse (Claude, decision:"block") and AfterTool (Gemini, decision:"deny").
 */
function redactBuiltinResponse(
  payload: HookPayload,
  redactor: Redactor,
  decision: 'block' | 'deny',
): void {
  if (!payload.tool_response) {
    process.exit(0);
  }

  const text = extractText(payload.tool_response);
  if (!text) {
    process.exit(0);
  }

  const { content, hasRedacted } = redactor.redact(text);
  if (!hasRedacted) {
    process.exit(0);
  }

  const response = {
    decision,
    reason: content as string,
  };

  process.stdout.write(JSON.stringify(response) + '\n');
  process.exit(0);
}

// ── Claude Code handlers ────────────────────────────────────────────────

/** Handle PreToolUse — redact outbound MCP tool arguments. */
function handlePreToolUse(payload: HookPayload, redactor: Redactor): void {
  redactToolInput(payload, redactor, (redactedInput) => ({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: redactedInput,
    },
  }));
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

/** Handle PostToolUse for built-in tools — decision: "block". */
function handlePostToolUseBuiltin(payload: HookPayload, redactor: Redactor): void {
  redactBuiltinResponse(payload, redactor, 'block');
}

// ── Gemini CLI handlers ─────────────────────────────────────────────────

/** Handle BeforeTool — redact outbound MCP tool arguments (Gemini format). */
function handleBeforeTool(payload: HookPayload, redactor: Redactor): void {
  redactToolInput(payload, redactor, (redactedInput) => ({
    hookSpecificOutput: {
      tool_input: redactedInput,
    },
  }));
}

/** Handle AfterTool for MCP tools — redact content array, flatten to deny/reason. */
function handleAfterToolMCP(payload: HookPayload, redactor: Redactor): void {
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

  // Flatten content blocks to a single text for Gemini's deny/reason format
  const textParts = (redactedArray as MCPContentBlock[])
    .filter((b) => typeof b.text === 'string')
    .map((b) => b.text as string);

  const response = {
    decision: 'deny' as const,
    reason: textParts.join('\n'),
  };

  process.stdout.write(JSON.stringify(response) + '\n');
  process.exit(0);
}

/** Handle AfterTool for built-in tools — decision: "deny". */
function handleAfterToolBuiltin(payload: HookPayload, redactor: Redactor): void {
  redactBuiltinResponse(payload, redactor, 'deny');
}

// ── Utilities ───────────────────────────────────────────────────────────

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

// ── Entry point ─────────────────────────────────────────────────────────

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

  // Claude Code events
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

  // Gemini CLI events
  if (eventName === 'BeforeTool') {
    handleBeforeTool(payload, redactor);
    return;
  }

  if (eventName === 'AfterTool') {
    if (isMCPTool(payload.tool_name)) {
      handleAfterToolMCP(payload, redactor);
    } else {
      handleAfterToolBuiltin(payload, redactor);
    }
    return;
  }

  // Backward compat: no hook_event_name → treat as PostToolUse built-in
  handlePostToolUseBuiltin(payload, redactor);
}
