/**
 * hush init — Generate Claude Code hook configuration
 *
 * Usage:
 *   hush init --hooks           Write to .claude/settings.json
 *   hush init --hooks --local   Write to .claude/settings.local.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const HUSH_HOOK = {
  type: 'command' as const,
  command: 'hush redact-hook',
  timeout: 10,
};

const HOOK_CONFIG = {
  hooks: {
    PreToolUse: [
      {
        matcher: 'mcp__.*',
        hooks: [HUSH_HOOK],
      },
    ],
    PostToolUse: [
      {
        matcher: 'Bash|Read|Grep|WebFetch',
        hooks: [HUSH_HOOK],
      },
      {
        matcher: 'mcp__.*',
        hooks: [HUSH_HOOK],
      },
    ],
  },
};

interface HookEntry {
  matcher: string;
  hooks: Array<{ type: string; command: string; timeout?: number }>;
}

interface SettingsJson {
  hooks?: {
    PreToolUse?: HookEntry[];
    PostToolUse?: HookEntry[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function hasHushHookInEntries(entries: HookEntry[] | undefined): boolean {
  if (!Array.isArray(entries)) return false;
  return entries.some((entry) =>
    entry.hooks?.some((h) => h.command?.includes('hush redact-hook')),
  );
}

function hasHushHook(settings: SettingsJson): boolean {
  return (
    hasHushHookInEntries(settings.hooks?.PreToolUse) &&
    hasHushHookInEntries(settings.hooks?.PostToolUse)
  );
}

function mergeHookEntries(
  existing: HookEntry[] | undefined,
  newEntries: HookEntry[],
): HookEntry[] {
  const merged = Array.isArray(existing) ? [...existing] : [];

  for (const entry of newEntries) {
    const alreadyHas = merged.some(
      (e) =>
        e.matcher === entry.matcher &&
        e.hooks?.some((h) => h.command?.includes('hush redact-hook')),
    );
    if (!alreadyHas) {
      merged.push(entry);
    }
  }

  return merged;
}

function mergeHooks(existing: SettingsJson): SettingsJson {
  const merged = { ...existing };

  if (!merged.hooks) {
    merged.hooks = {};
  }

  merged.hooks = {
    ...merged.hooks,
    PreToolUse: mergeHookEntries(merged.hooks.PreToolUse, HOOK_CONFIG.hooks.PreToolUse),
    PostToolUse: mergeHookEntries(merged.hooks.PostToolUse, HOOK_CONFIG.hooks.PostToolUse),
  };

  return merged;
}

export function run(args: string[]): void {
  const hasHooksFlag = args.includes('--hooks');
  const isLocal = args.includes('--local');

  if (!hasHooksFlag) {
    process.stderr.write('Usage: hush init --hooks [--local]\n');
    process.stderr.write('\n');
    process.stderr.write('Options:\n');
    process.stderr.write('  --hooks   Generate Claude Code hook config (PreToolUse + PostToolUse)\n');
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
