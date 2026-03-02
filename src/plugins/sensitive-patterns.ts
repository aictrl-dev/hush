/**
 * Shared helpers for detecting sensitive file paths and commands.
 * Used by the OpenCode hush plugin to block reads of secret files.
 */

/** Glob-style patterns for files that should never be read by AI tools. */
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

/**
 * Check whether a file path points to a sensitive file.
 * Matches against the basename only so absolute/relative paths both work.
 */
export function isSensitivePath(filePath: string): boolean {
  const basename = filePath.split('/').pop() ?? '';
  return SENSITIVE_GLOBS.some((re) => re.test(basename));
}

/** Commands that read file contents (includes batcat — Ubuntu symlink for bat). */
const READ_COMMANDS = /\b(cat|head|tail|less|more|bat|batcat)\b/;

/**
 * Check whether a bash command reads a sensitive file.
 * Looks for common read commands followed by a sensitive filename.
 */
export function commandReadsSensitiveFile(cmd: string): boolean {
  if (!READ_COMMANDS.test(cmd)) return false;

  // Split on pipes/semicolons/&& to get individual commands
  const parts = cmd.split(/[|;&]+/);
  for (const part of parts) {
    const tokens = part.trim().split(/\s+/);
    const cmdIndex = tokens.findIndex((t) => READ_COMMANDS.test(t));
    if (cmdIndex === -1) continue;

    // Check all tokens after the command for sensitive paths (skip flags).
    // Expand shell variables/tilde so `cat $HOME/.env` and `cat ~/secrets/.env` are caught.
    for (let i = cmdIndex + 1; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (token.startsWith('-')) continue; // skip flags like -n, -5
      const expanded = token.replace(/^~\//, '/home/user/').replace(/\$\{?\w+\}?\//g, '/');
      if (isSensitivePath(expanded)) return true;
    }
  }
  return false;
}
