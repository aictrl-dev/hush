import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';

/**
 * Integration tests for `hush redact-hook`.
 * Spawns the CLI as a child process with piped stdin, matching real hook usage.
 */
const CLI = join(__dirname, '..', 'dist', 'cli.js');

function runHook(input: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI, 'redact-hook'], {
      input,
      encoding: 'utf-8',
      timeout: 5000,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      exitCode: err.status ?? 1,
    };
  }
}

describe('hush redact-hook', () => {
  // ── PostToolUse built-in tools (existing tests) ──────────────────────

  it('should redact email from Bash stdout', () => {
    const payload = {
      tool_name: 'Bash',
      tool_response: { stdout: 'email: test@foo.com' },
    };
    const { stdout, exitCode } = runHook(JSON.stringify(payload));
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.decision).toBe('block');
    expect(result.reason).toMatch(/\[USER_EMAIL_[a-f0-9]{6}\]/);
    expect(result.reason).not.toContain('test@foo.com');
  });

  it('should redact email from Read file.content', () => {
    const payload = {
      tool_name: 'Read',
      tool_response: { file: { content: 'Contact: admin@internal.corp', filePath: '/app/config.json' } },
    };
    const { stdout, exitCode } = runHook(JSON.stringify(payload));
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.decision).toBe('block');
    expect(result.reason).toMatch(/\[USER_EMAIL_[a-f0-9]{6}\]/);
    expect(result.reason).not.toContain('admin@internal.corp');
  });

  it('should redact IP address from Bash stderr', () => {
    const payload = {
      tool_name: 'Bash',
      tool_response: { stderr: 'connection to 192.168.1.100 failed' },
    };
    const { stdout, exitCode } = runHook(JSON.stringify(payload));
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.decision).toBe('block');
    expect(result.reason).toMatch(/\[NETWORK_IP_[a-f0-9]{6}\]/);
  });

  it('should pass through clean output (no PII) with no output', () => {
    const payload = {
      tool_name: 'Bash',
      tool_response: { stdout: 'hello world' },
    };
    const { stdout, exitCode } = runHook(JSON.stringify(payload));
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('');
  });

  it('should handle empty stdin gracefully', () => {
    const { stdout, exitCode } = runHook('');
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('');
  });

  it('should exit 2 for invalid JSON', () => {
    const { exitCode, stderr } = runHook('not json');
    expect(exitCode).toBe(2);
    expect(stderr).toContain('invalid JSON');
  });

  it('should handle payload with no tool_response', () => {
    const payload = { tool_name: 'Bash' };
    const { stdout, exitCode } = runHook(JSON.stringify(payload));
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('');
  });

  it('should combine stdout and stderr when both have PII', () => {
    const payload = {
      tool_name: 'Bash',
      tool_response: {
        stdout: 'user email: alice@example.com',
        stderr: 'warning: 10.0.0.1 unreachable',
      },
    };
    const { stdout, exitCode } = runHook(JSON.stringify(payload));
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.decision).toBe('block');
    expect(result.reason).toMatch(/\[USER_EMAIL_[a-f0-9]{6}\]/);
    expect(result.reason).toMatch(/\[NETWORK_IP_[a-f0-9]{6}\]/);
  });

  it('should redact secrets from tool response', () => {
    const payload = {
      tool_name: 'Bash',
      tool_response: { stdout: 'api_key=sk-1234567890abcdef1234' },
    };
    const { stdout, exitCode } = runHook(JSON.stringify(payload));
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.decision).toBe('block');
    expect(result.reason).toMatch(/\[SENSITIVE_SECRET_[a-f0-9]{6}\]/);
  });

  it('should handle Grep tool with top-level content field', () => {
    const payload = {
      tool_name: 'Grep',
      tool_response: { content: 'src/config.ts:3:  email: "dev@internal.corp"' },
    };
    const { stdout, exitCode } = runHook(JSON.stringify(payload));
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.decision).toBe('block');
    expect(result.reason).toMatch(/\[USER_EMAIL_[a-f0-9]{6}\]/);
    expect(result.reason).not.toContain('dev@internal.corp');
  });

  // ── PostToolUse built-in with explicit hook_event_name ───────────────

  it('should use decision:block for PostToolUse built-in with explicit event name', () => {
    const payload = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_response: { stdout: 'email: test@foo.com' },
    };
    const { stdout, exitCode } = runHook(JSON.stringify(payload));
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.decision).toBe('block');
    expect(result.reason).toMatch(/\[USER_EMAIL_[a-f0-9]{6}\]/);
  });

  // ── Backward compat: no hook_event_name ──────────────────────────────

  it('should fall back to PostToolUse built-in when hook_event_name is absent', () => {
    const payload = {
      tool_name: 'Read',
      tool_response: { file: { content: 'Contact: fallback@legacy.com' } },
    };
    const { stdout, exitCode } = runHook(JSON.stringify(payload));
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.decision).toBe('block');
    expect(result.reason).toMatch(/\[USER_EMAIL_[a-f0-9]{6}\]/);
    expect(result.reason).not.toContain('fallback@legacy.com');
  });

  // ── PreToolUse (outbound MCP arg redaction) ──────────────────────────

  describe('PreToolUse — outbound MCP arg redaction', () => {
    it('should redact email in MCP tool input and return updatedInput', () => {
      const payload = {
        hook_event_name: 'PreToolUse',
        tool_name: 'mcp__slack__send_message',
        tool_input: {
          channel: '#general',
          text: 'Please contact admin@secret.corp for access',
        },
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput.hookEventName).toBe('PreToolUse');
      expect(result.hookSpecificOutput.permissionDecision).toBe('allow');
      expect(result.hookSpecificOutput.updatedInput.text).toMatch(/\[USER_EMAIL_[a-f0-9]{6}\]/);
      expect(result.hookSpecificOutput.updatedInput.text).not.toContain('admin@secret.corp');
      // Non-PII fields preserved
      expect(result.hookSpecificOutput.updatedInput.channel).toBe('#general');
    });

    it('should pass through clean input with no output', () => {
      const payload = {
        hook_event_name: 'PreToolUse',
        tool_name: 'mcp__miro__create_card',
        tool_input: {
          title: 'Sprint planning',
          description: 'Weekly sync meeting notes',
        },
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
    });

    it('should pass through when no tool_input is present', () => {
      const payload = {
        hook_event_name: 'PreToolUse',
        tool_name: 'mcp__db__list_tables',
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
    });

    it('should redact nested PII in complex tool input', () => {
      const payload = {
        hook_event_name: 'PreToolUse',
        tool_name: 'mcp__notion__create_page',
        tool_input: {
          title: 'User Report',
          properties: {
            email: 'user@private.org',
            ip: 'Connected from 10.20.30.40',
          },
        },
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      const updated = result.hookSpecificOutput.updatedInput;
      expect(updated.properties.email).toMatch(/\[USER_EMAIL_[a-f0-9]{6}\]/);
      expect(updated.properties.ip).toMatch(/\[NETWORK_IP_[a-f0-9]{6}\]/);
      expect(updated.title).toBe('User Report');
    });
  });

  // ── PostToolUse MCP (inbound result redaction) ───────────────────────

  describe('PostToolUse MCP — inbound result redaction', () => {
    it('should redact email in MCP content array and return updatedMCPToolOutput', () => {
      const payload = {
        hook_event_name: 'PostToolUse',
        tool_name: 'mcp__slack__read_channel',
        tool_response: {
          content: [
            { type: 'text', text: 'Message from admin@company.io: hello team' },
          ],
        },
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      expect(result.updatedMCPToolOutput).toBeDefined();
      expect(result.updatedMCPToolOutput.content).toHaveLength(1);
      expect(result.updatedMCPToolOutput.content[0].type).toBe('text');
      expect(result.updatedMCPToolOutput.content[0].text).toMatch(/\[USER_EMAIL_[a-f0-9]{6}\]/);
      expect(result.updatedMCPToolOutput.content[0].text).not.toContain('admin@company.io');
    });

    it('should pass through clean MCP content with no output', () => {
      const payload = {
        hook_event_name: 'PostToolUse',
        tool_name: 'mcp__miro__get_board',
        tool_response: {
          content: [
            { type: 'text', text: 'Board "Sprint 42" has 15 cards' },
          ],
        },
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
    });

    it('should redact PII in multiple content blocks selectively', () => {
      const payload = {
        hook_event_name: 'PostToolUse',
        tool_name: 'mcp__db__query',
        tool_response: {
          content: [
            { type: 'text', text: 'Query results:' },
            { type: 'text', text: 'Row 1: user@leaked.com, 192.168.0.1' },
            { type: 'text', text: 'Row 2: no PII here' },
          ],
        },
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      const blocks = result.updatedMCPToolOutput.content;
      expect(blocks).toHaveLength(3);
      // First block — no PII, unchanged
      expect(blocks[0].text).toBe('Query results:');
      // Second block — both email and IP redacted
      expect(blocks[1].text).toMatch(/\[USER_EMAIL_[a-f0-9]{6}\]/);
      expect(blocks[1].text).toMatch(/\[NETWORK_IP_[a-f0-9]{6}\]/);
      expect(blocks[1].text).not.toContain('user@leaked.com');
      // Third block — no PII, unchanged
      expect(blocks[2].text).toBe('Row 2: no PII here');
    });

    it('should handle MCP PostToolUse with no content array', () => {
      const payload = {
        hook_event_name: 'PostToolUse',
        tool_name: 'mcp__slack__ping',
        tool_response: { status: 'ok' },
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
    });

    it('should handle MCP PostToolUse with no tool_response', () => {
      const payload = {
        hook_event_name: 'PostToolUse',
        tool_name: 'mcp__slack__ping',
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
    });
  });

  // ── Gemini CLI: BeforeTool (outbound MCP arg redaction) ───────────────

  describe('BeforeTool — Gemini outbound MCP arg redaction', () => {
    it('should redact email and return hookSpecificOutput.tool_input (no Claude fields)', () => {
      const payload = {
        hook_event_name: 'BeforeTool',
        tool_name: 'mcp__slack__send_message',
        tool_input: {
          channel: '#general',
          text: 'Please contact admin@secret.corp for access',
        },
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput.tool_input).toBeDefined();
      expect(result.hookSpecificOutput.tool_input.text).toMatch(/\[USER_EMAIL_[a-f0-9]{6}\]/);
      expect(result.hookSpecificOutput.tool_input.text).not.toContain('admin@secret.corp');
      expect(result.hookSpecificOutput.tool_input.channel).toBe('#general');
      // Should NOT have Claude-specific fields
      expect(result.hookSpecificOutput.hookEventName).toBeUndefined();
      expect(result.hookSpecificOutput.permissionDecision).toBeUndefined();
      expect(result.hookSpecificOutput.updatedInput).toBeUndefined();
    });

    it('should pass through clean input with no output', () => {
      const payload = {
        hook_event_name: 'BeforeTool',
        tool_name: 'mcp__miro__create_card',
        tool_input: {
          title: 'Sprint planning',
          description: 'Weekly sync meeting notes',
        },
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
    });

    it('should pass through when no tool_input is present', () => {
      const payload = {
        hook_event_name: 'BeforeTool',
        tool_name: 'mcp__db__list_tables',
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
    });
  });

  // ── Gemini CLI: AfterTool built-in (inbound result redaction) ─────────

  describe('AfterTool built-in — Gemini inbound result redaction', () => {
    it('should redact email and return decision:"deny" (not "block")', () => {
      const payload = {
        hook_event_name: 'AfterTool',
        tool_name: 'run_shell_command',
        tool_response: { stdout: 'email: test@foo.com' },
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      expect(result.decision).toBe('deny');
      expect(result.reason).toMatch(/\[USER_EMAIL_[a-f0-9]{6}\]/);
      expect(result.reason).not.toContain('test@foo.com');
    });

    it('should pass through clean output with no output', () => {
      const payload = {
        hook_event_name: 'AfterTool',
        tool_name: 'read_file',
        tool_response: { stdout: 'hello world' },
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
    });

    it('should pass through when no tool_response', () => {
      const payload = {
        hook_event_name: 'AfterTool',
        tool_name: 'read_file',
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
    });
  });

  // ── Gemini CLI: AfterTool MCP (inbound MCP result redaction) ──────────

  describe('AfterTool MCP — Gemini inbound MCP result redaction', () => {
    it('should redact email in content array and return deny/reason with joined text', () => {
      const payload = {
        hook_event_name: 'AfterTool',
        tool_name: 'mcp__slack__read_channel',
        tool_response: {
          content: [
            { type: 'text', text: 'Message from admin@company.io: hello team' },
          ],
        },
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      expect(result.decision).toBe('deny');
      expect(result.reason).toMatch(/\[USER_EMAIL_[a-f0-9]{6}\]/);
      expect(result.reason).not.toContain('admin@company.io');
    });

    it('should join multiple content blocks into reason', () => {
      const payload = {
        hook_event_name: 'AfterTool',
        tool_name: 'mcp__db__query',
        tool_response: {
          content: [
            { type: 'text', text: 'Row 1: user@leaked.com' },
            { type: 'text', text: 'Row 2: 192.168.0.1' },
          ],
        },
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      expect(result.decision).toBe('deny');
      expect(result.reason).toMatch(/\[USER_EMAIL_[a-f0-9]{6}\]/);
      expect(result.reason).toMatch(/\[NETWORK_IP_[a-f0-9]{6}\]/);
    });

    it('should pass through clean MCP content with no output', () => {
      const payload = {
        hook_event_name: 'AfterTool',
        tool_name: 'mcp__miro__get_board',
        tool_response: {
          content: [
            { type: 'text', text: 'Board "Sprint 42" has 15 cards' },
          ],
        },
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
    });

    it('should handle AfterTool MCP with no content array', () => {
      const payload = {
        hook_event_name: 'AfterTool',
        tool_name: 'mcp__slack__ping',
        tool_response: { status: 'ok' },
      };
      const { stdout, exitCode } = runHook(JSON.stringify(payload));
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
    });
  });
});
