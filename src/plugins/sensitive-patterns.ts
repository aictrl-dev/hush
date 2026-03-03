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
  const basename = (filePath.split('/').pop() ?? '').trim();
  return SENSITIVE_GLOBS.some((re) => re.test(basename));
}

/** Commands that read file contents (includes batcat — Ubuntu symlink for bat). */
const READ_COMMANDS = /\b(cat|head|tail|less|more|bat|batcat)\b/;

/** Strip shell metacharacters that could wrap a filename to bypass detection. */
function stripShellMeta(token: string): string {
  // Handle ANSI-C quoting $'.env' and common shell wrappers
  return token.replace(/^\$?'/, '').replace(/'$/, '').replace(/[`"'$(){}]/g, '');
}

/**
 * Check whether a bash command reads a sensitive file.
 * Looks for common read commands followed by a sensitive filename.
 */
export function commandReadsSensitiveFile(cmd: string): boolean {
  if (!READ_COMMANDS.test(cmd)) return false;

  // Check input redirections: `cat <.env` or `cat < .env`
  // The file after `<` is read by the preceding command.
  const redirectPattern = /<\s*([^\s|;&<>]+)/g;
  let rMatch;
  while ((rMatch = redirectPattern.exec(cmd)) !== null) {
    const token = rMatch[1]!;
    // Block if it looks like an environment variable expansion which could hide a secret path
    if (token.includes('$')) return true;
    if (isSensitivePath(stripShellMeta(token))) return true;
  }

  // Split on pipes, semicolons, &&, and redirections to get individual commands
  const parts = cmd.split(/[|;&<>]+/);
  for (const part of parts) {
    const tokens = part.trim().split(/\s+/);
    const cmdIndex = tokens.findIndex((t) => READ_COMMANDS.test(t));
    if (cmdIndex === -1) continue;

    // Check all tokens after the command for sensitive paths (skip flags).
    for (let i = cmdIndex + 1; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (token.startsWith('-')) continue; // skip flags like -n, -5
      
      // Block environment variable usage in read commands as a safety measure
      // (e.g. cat $SECRET_FILE)
      if (token.includes('$')) return true;

      const cleaned = stripShellMeta(token);
      if (isSensitivePath(cleaned)) return true;
    }
  }
  return false;
}
