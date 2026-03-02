/**
 * hush init — Generate Claude Code hook configuration
 *
 * Usage:
 *   hush init --hooks           Write to .claude/settings.json
 *   hush init --hooks --local   Write to .claude/settings.local.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const HOOK_CONFIG = {
  hooks: {
    PostToolUse: [
      {
        matcher: 'Bash|Read|Grep|WebFetch',
        hooks: [
          {
            type: 'command' as const,
            command: 'hush redact-hook',
            timeout: 10,
          },
        ],
      },
    ],
  },
};

interface SettingsJson {
  hooks?: {
    PostToolUse?: Array<{
      matcher: string;
      hooks: Array<{ type: string; command: string; timeout?: number }>;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function hasHushHook(settings: SettingsJson): boolean {
  const postToolUse = settings.hooks?.PostToolUse;
  if (!Array.isArray(postToolUse)) return false;

  return postToolUse.some((entry) =>
    entry.hooks?.some((h) => h.command?.includes('hush redact-hook')),
  );
}

function mergeHooks(existing: SettingsJson): SettingsJson {
  const merged = { ...existing };

  if (!merged.hooks) {
    merged.hooks = {};
  }

  if (!Array.isArray(merged.hooks.PostToolUse)) {
    merged.hooks.PostToolUse = [];
  }

  merged.hooks = { ...merged.hooks, PostToolUse: [...merged.hooks.PostToolUse, ...HOOK_CONFIG.hooks.PostToolUse] };

  return merged;
}

export function run(args: string[]): void {
  const hasHooksFlag = args.includes('--hooks');
  const isLocal = args.includes('--local');

  if (!hasHooksFlag) {
    process.stderr.write('Usage: hush init --hooks [--local]\n');
    process.stderr.write('\n');
    process.stderr.write('Options:\n');
    process.stderr.write('  --hooks   Generate Claude Code PostToolUse hook config\n');
    process.stderr.write('  --local   Write to settings.local.json instead of settings.json\n');
    process.exit(1);
  }

  const claudeDir = join(process.cwd(), '.claude');
  const filename = isLocal ? 'settings.local.json' : 'settings.json';
  const filePath = join(claudeDir, filename);

  // Ensure .claude/ exists
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  // Read existing settings or start fresh
  let settings: SettingsJson = {};
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      settings = JSON.parse(raw) as SettingsJson;
    } catch {
      process.stderr.write(`Warning: could not parse ${filePath}, starting fresh\n`);
    }
  }

  // Idempotency check
  if (hasHushHook(settings)) {
    process.stdout.write(`hush hooks already configured in ${filePath}\n`);
    return;
  }

  const merged = mergeHooks(settings);
  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n');
  process.stdout.write(`Wrote hush hooks config to ${filePath}\n`);
}
