import { describe, it, expect } from 'vitest';
import { isSensitivePath, commandReadsSensitiveFile } from '../src/plugins/sensitive-patterns.js';
import { HushPlugin } from '../src/plugins/opencode-hush.js';

describe('isSensitivePath', () => {
  it.each([
    '.env',
    '.env.local',
    '.env.production',
    '.env.development.local',
    'credentials.json',
    'credentials.yaml',
    'db-credentials',
    'secret.txt',
    'secrets.yaml',
    'server.pem',
    'tls.key',
    'id_rsa',
    'id_rsa.pub',
    '.netrc',
    '.pgpass',
    'keystore.p12',
    'cert.pfx',
    'truststore.jks',
    'app.keystore',
    'private.asc',
  ])('blocks %s', (path) => {
    expect(isSensitivePath(path)).toBe(true);
  });

  it.each([
    '.env',
    '/home/user/project/.env.local',
    '/etc/ssl/private/server.key',
    'config/credentials.json',
  ])('blocks absolute/relative path %s', (path) => {
    expect(isSensitivePath(path)).toBe(true);
  });

  it.each([
    'package.json',
    'src/index.ts',
    'README.md',
    'tsconfig.json',
    '.gitignore',
    'environment.ts',
    'docker-compose.yml',
  ])('allows %s', (path) => {
    expect(isSensitivePath(path)).toBe(false);
  });
});

describe('commandReadsSensitiveFile', () => {
  it.each([
    'cat .env',
    'cat /app/.env.local',
    'head -5 secrets.yaml',
    'tail -n 20 credentials.json',
    'less .env.production',
    'more secret.txt',
    'bat id_rsa',
    'cat .pgpass',
    'cat foo.txt && cat .env',
    'echo hello | cat .env',
    'cat $HOME/.env',
    'cat ${HOME}/.env',
    'cat ~/secrets/.env',
    'cat ~/.pgpass',
    'batcat .env',
    'batcat id_rsa',
  ])('blocks: %s', (cmd) => {
    expect(commandReadsSensitiveFile(cmd)).toBe(true);
  });

  it.each([
    'cat README.md',
    'ls -la',
    'echo "hello"',
    'grep password src/config.ts',
    'head -5 package.json',
    'cat src/index.ts',
    'npm install',
    'node dist/cli.js',
  ])('allows: %s', (cmd) => {
    expect(commandReadsSensitiveFile(cmd)).toBe(false);
  });
});

describe('HushPlugin integration', () => {
  it('exports a factory that returns a tool.execute.before hook', async () => {
    const plugin = await HushPlugin();
    expect(plugin['tool.execute.before']).toBeTypeOf('function');
  });

  it('throws when read targets a sensitive file', async () => {
    const plugin = await HushPlugin();
    await expect(
      plugin['tool.execute.before'](
        { tool: 'read' },
        { args: { filePath: '/project/.env' } },
      ),
    ).rejects.toThrow('[hush] Blocked: sensitive file');
  });

  it('passes when read targets a normal file', async () => {
    const plugin = await HushPlugin();
    await expect(
      plugin['tool.execute.before'](
        { tool: 'read' },
        { args: { filePath: 'src/index.ts' } },
      ),
    ).resolves.toBeUndefined();
  });

  it('throws when bash command reads a sensitive file', async () => {
    const plugin = await HushPlugin();
    await expect(
      plugin['tool.execute.before'](
        { tool: 'bash' },
        { args: { command: 'cat .env' } },
      ),
    ).rejects.toThrow('[hush] Blocked: command reads sensitive file');
  });

  it('passes when bash command is harmless', async () => {
    const plugin = await HushPlugin();
    await expect(
      plugin['tool.execute.before'](
        { tool: 'bash' },
        { args: { command: 'ls -la' } },
      ),
    ).resolves.toBeUndefined();
  });

  it('passes for unrelated tools', async () => {
    const plugin = await HushPlugin();
    await expect(
      plugin['tool.execute.before'](
        { tool: 'write' },
        { args: { filePath: '.env', content: 'x' } },
      ),
    ).resolves.toBeUndefined();
  });
});
