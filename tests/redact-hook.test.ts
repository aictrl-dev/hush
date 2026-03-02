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
});
