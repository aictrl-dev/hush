/**
 * hush init — Generate hook configuration for Claude Code or Gemini CLI
 *
 * Usage:
 *   hush init --hooks           Write to .claude/settings.json
 *   hush init --hooks --local   Write to .claude/settings.local.json
 *   hush init --hooks --gemini  Write to .gemini/settings.json
 *   hush init --hooks --gemini --local  Write to .gemini/settings.local.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const HUSH_HOOK = {
  type: 'command' as const,
  command: 'hush redact-hook',
  timeout: 10,
};

const CLAUDE_HOOK_CONFIG = {
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

const GEMINI_HOOK_CONFIG = {
  hooks: {
    BeforeTool: [
      {
        matcher: 'mcp__.*',
        hooks: [HUSH_HOOK],
      },
    ],
    AfterTool: [
      {
        matcher: 'run_shell_command|read_file|read_many_files|search_file_content|web_fetch',
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
    BeforeTool?: HookEntry[];
    AfterTool?: HookEntry[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface HookConfig {
  hooks: Record<string, HookEntry[]>;
}

function hasHushHookInEntries(entries: HookEntry[] | undefined): boolean {
  if (!Array.isArray(entries)) return false;
  return entries.some((entry) =>
    entry.hooks?.some((h) => h.command?.includes('hush redact-hook')),
  );
}

function hasHushHookClaude(settings: SettingsJson): boolean {
  return (
    hasHushHookInEntries(settings.hooks?.PreToolUse) &&
    hasHushHookInEntries(settings.hooks?.PostToolUse)
  );
}

function hasHushHookGemini(settings: SettingsJson): boolean {
  return (
    hasHushHookInEntries(settings.hooks?.BeforeTool) &&
    hasHushHookInEntries(settings.hooks?.AfterTool)
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

function mergeHooks(existing: SettingsJson, hookConfig: HookConfig): SettingsJson {
  const merged = { ...existing };

  if (!merged.hooks) {
    merged.hooks = {};
  }

  for (const [eventName, entries] of Object.entries(hookConfig.hooks)) {
    const existingEntries = merged.hooks[eventName] as HookEntry[] | undefined;
    merged.hooks[eventName] = mergeHookEntries(existingEntries, entries);
  }

  return merged;
}

export function run(args: string[]): void {
  const hasHooksFlag = args.includes('--hooks');
  const isLocal = args.includes('--local');
  const isGemini = args.includes('--gemini');

  if (!hasHooksFlag) {
    process.stderr.write('Usage: hush init --hooks [--local] [--gemini]\n');
    process.stderr.write('\n');
    process.stderr.write('Options:\n');
    process.stderr.write('  --hooks   Generate hook config (PreToolUse + PostToolUse or BeforeTool + AfterTool)\n');
    process.stderr.write('  --local   Write to settings.local.json instead of settings.json\n');
    process.stderr.write('  --gemini  Write Gemini CLI hooks instead of Claude Code hooks\n');
    process.exit(1);
  }

  const dirName = isGemini ? '.gemini' : '.claude';
  const configDir = join(process.cwd(), dirName);
  const filename = isLocal ? 'settings.local.json' : 'settings.json';
  const filePath = join(configDir, filename);

  // Ensure config dir exists
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
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
  const hookConfig = isGemini ? GEMINI_HOOK_CONFIG : CLAUDE_HOOK_CONFIG;
  const hasHook = isGemini ? hasHushHookGemini : hasHushHookClaude;

  if (hasHook(settings)) {
    process.stdout.write(`hush hooks already configured in ${filePath}\n`);
    return;
  }

  const merged = mergeHooks(settings, hookConfig);
  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n');
  process.stdout.write(`Wrote hush hooks config to ${filePath}\n`);
}
