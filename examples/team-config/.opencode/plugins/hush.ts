/**
 * Hush PII Guard — OpenCode Plugin (drop-in copy)
 *
 * Blocks reads of sensitive files (.env, *.pem, credentials.*, etc.)
 * before the tool executes — the AI model never sees the content.
 *
 * Usage: copy this file to `.opencode/plugins/hush.ts` in your project
 * and add to `opencode.json`:
 *   { "plugin": [".opencode/plugins/hush.ts"] }
 *
 * Or install from npm:
 *   import { HushPlugin } from '@aictrl/hush/opencode-plugin'
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
  const basename = filePath.split('/').pop() ?? '';
  return SENSITIVE_GLOBS.some((re) => re.test(basename));
}

const READ_COMMANDS = /\b(cat|head|tail|less|more|bat)\b/;

function commandReadsSensitiveFile(cmd: string): boolean {
  if (!READ_COMMANDS.test(cmd)) return false;
  const parts = cmd.split(/[|;&]+/);
  for (const part of parts) {
    const tokens = part.trim().split(/\s+/);
    const cmdIndex = tokens.findIndex((t) => READ_COMMANDS.test(t));
    if (cmdIndex === -1) continue;
    for (let i = cmdIndex + 1; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (token.startsWith('-')) continue;
      if (isSensitivePath(token)) return true;
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
