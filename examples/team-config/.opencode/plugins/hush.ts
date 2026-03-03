/**
 * Hush PII Guard — OpenCode Plugin (drop-in copy)
 *
 * This drop-in copy provides file-blocking only (sensitive file reads).
 * For full bidirectional PII redaction (tool args + tool results),
 * install from npm instead:
 *
 *   npm install @aictrl/hush
 *
 * Then in your plugin entry point:
 *   import { HushPlugin } from '@aictrl/hush/opencode-plugin'
 *
 * Usage (drop-in): copy this file to `.opencode/plugins/hush.ts` in your
 * project and add to `opencode.json`:
 *   { "plugin": [".opencode/plugins/hush.ts"] }
 */

const SENSITIVE_GLOBS = [
  /^\.env($|\..*)/, // .env, .env.local, .env.production, etc.
  /credentials/i,
  /secret/i,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /\.jks$/,
  /\.keystore$/,
  /\.asc$/,
  /^id_rsa/,
  /^\.netrc$/,
  /^\.pgpass$/,
];

function isSensitivePath(filePath: string): boolean {
  const basename = (filePath.split('/').pop() ?? '').trim();
  return SENSITIVE_GLOBS.some((re) => re.test(basename));
}

const READ_COMMANDS = /\b(cat|head|tail|less|more|bat|batcat)\b/;

function stripShellMeta(token: string): string {
  return token.replace(/[`"'$(){}]/g, '');
}

function commandReadsSensitiveFile(cmd: string): boolean {
  if (!READ_COMMANDS.test(cmd)) return false;
  const redirectPattern = /<\s*([^\s|;&<>]+)/g;
  let rMatch;
  while ((rMatch = redirectPattern.exec(cmd)) !== null) {
    if (isSensitivePath(stripShellMeta(rMatch[1]!))) return true;
  }
  const parts = cmd.split(/[|;&<>]+/);
  for (const part of parts) {
    const tokens = part.trim().split(/\s+/);
    const cmdIndex = tokens.findIndex((t) => READ_COMMANDS.test(t));
    if (cmdIndex === -1) continue;
    for (let i = cmdIndex + 1; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (token.startsWith('-')) continue;
      const cleaned = stripShellMeta(token);
      if (isSensitivePath(cleaned)) return true;
    }
  }
  return false;
}

export const HushPlugin = async () => ({
  'tool.execute.before': async (
    input: { tool: string },
    output: { args: Record<string, string> },
  ) => {
    if (input.tool === 'read' && isSensitivePath(output.args['filePath'] ?? '')) {
      throw new Error('[hush] Blocked: sensitive file');
    }
    if (input.tool === 'bash' && commandReadsSensitiveFile(output.args['command'] ?? '')) {
      throw new Error('[hush] Blocked: command reads sensitive file');
    }
  },
});
