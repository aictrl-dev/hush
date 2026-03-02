import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';

const CLI = join(__dirname, '..', 'dist', 'cli.js');

function runInit(cwd: string, ...extraArgs: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI, 'init', '--hooks', ...extraArgs], {
      encoding: 'utf-8',
      cwd,
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

describe('hush init --hooks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hush-init-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create .claude/settings.json from scratch', () => {
    const { stdout, exitCode } = runInit(tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Wrote hush hooks config');

    const settings = JSON.parse(readFileSync(join(tmpDir, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0].matcher).toBe('Bash|Read|Grep|WebFetch');
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe('hush redact-hook');
  });

  it('should merge into existing settings preserving other keys', () => {
    const claudeDir = join(tmpDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, 'settings.json'),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000' } }, null, 2),
    );

    const { exitCode } = runInit(tmpDir);
    expect(exitCode).toBe(0);

    const settings = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8'));
    // Preserved existing env
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:4000');
    // Added hooks
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe('hush redact-hook');
  });

  it('should be idempotent on re-run', () => {
    runInit(tmpDir);
    const { stdout, exitCode } = runInit(tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('already configured');

    const settings = JSON.parse(readFileSync(join(tmpDir, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks.PostToolUse).toHaveLength(1); // Not duplicated
  });

  it('should write to settings.local.json with --local flag', () => {
    const { stdout, exitCode } = runInit(tmpDir, '--local');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('settings.local.json');

    const localPath = join(tmpDir, '.claude', 'settings.local.json');
    expect(existsSync(localPath)).toBe(true);

    const settings = JSON.parse(readFileSync(localPath, 'utf-8'));
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe('hush redact-hook');
  });

  it('should show usage without --hooks flag', () => {
    try {
      execFileSync('node', [CLI, 'init'], {
        encoding: 'utf-8',
        cwd: tmpDir,
        timeout: 5000,
      });
    } catch (err: any) {
      expect(err.status).toBe(1);
      expect(err.stderr).toContain('Usage');
    }
  });
});
