import { describe, it, expect, beforeEach } from 'vitest';
import { Redactor } from '../src/middleware/redactor';
import { TokenVault } from '../src/vault/token-vault';

describe('Semantic Security Flow (Redaction + Rehydration)', () => {
  let redactor: Redactor;
  let vault: TokenVault;

  beforeEach(() => {
    redactor = new Redactor();
    vault = new TokenVault();
  });

  it('should redact common PII types from tool arguments', () => {
    const args = {
      email: 'user@example.com',
      ipv4: '192.168.1.1',
      ipv6: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      config: {
        apiKey: 'sk-1234567890abcdef12345',
        secretToken: 'very-secret-string-of-length-32'
      },
      message: 'Contact me at support@company.org or visit 10.0.0.1'
    };

    const { content, hasRedacted, tokens } = redactor.redact(args);

    expect(hasRedacted).toBe(true);
    expect(content.email).toMatch(/^\[USER_EMAIL_[a-f0-9]{6}\]$/);
    expect(content.ipv4).toMatch(/^\[NETWORK_IP_[a-f0-9]{6}\]$/);
    expect(content.ipv6).toMatch(/^\[NETWORK_IP_V6_[a-f0-9]{6}\]$/);
    expect(content.config.apiKey).toMatch(/\[SENSITIVE_SECRET_[a-f0-9]{6}\]/);
    expect(content.config.secretToken).toMatch(/\[SENSITIVE_SECRET_[a-f0-9]{6}\]/);
    expect(content.message).toMatch(/\[USER_EMAIL_[a-f0-9]{6}\]/);
    expect(content.message).toMatch(/\[NETWORK_IP_[a-f0-9]{6}\]/);
    expect(tokens.size).toBe(7);
  });

  it('should redact credit card numbers', () => {
    const input = 'My card is 4111-1111-1111-1111 and it expires soon';
    const { content, hasRedacted } = redactor.redact(input);

    expect(hasRedacted).toBe(true);
    expect(content).toMatch(/My card is \[PAYMENT_CARD_[a-f0-9]{6}\] and it expires soon/);
  });

  it('should redact phone numbers including complex formats', () => {
    const input = 'Call me at 555-010-0199 or +1 (555) 123-4567. UK: +44 20 7946 0958';
    const { content, hasRedacted } = redactor.redact(input);

    expect(hasRedacted).toBe(true);
    expect(content).toMatch(/\[PHONE_NUMBER_[a-f0-9]{6}\]/);
  });

  it('should not redact numeric IDs that look like partial phones', () => {
    const input = 'User ID: 12345678, Version: 1.0-alpha';
    const { hasRedacted } = redactor.redact(input);

    expect(hasRedacted).toBe(false);
  });

  it('should re-hydrate redacted content accurately using the vault', () => {
    const rawArgs = {
      user: 'bulat@aictrl.dev',
      key: 'api-key: super-secret-key-12345'
    };

    // 1. Redact outbound (to LLM/Server)
    const { content: redacted, tokens } = redactor.redact(rawArgs);
    vault.saveTokens(tokens);

    expect(redacted.user).toMatch(/^\[USER_EMAIL_[a-f0-9]{6}\]$/);
    expect(redacted.key).toMatch(/\[SENSITIVE_SECRET_[a-f0-9]{6}\]/);

    // 2. Simulate result containing tokens coming back
    const resultWithTokens = {
      status: 'Success',
      log: `Processing request for ${redacted.user} with key ${redacted.key.match(/\[SENSITIVE_SECRET_[a-f0-9]{6}\]/)![0]}`
    };

    // 3. Re-hydrate locally for developer visibility
    const finalResult = vault.rehydrate(resultWithTokens);

    expect(finalResult.log).toBe('Processing request for bulat@aictrl.dev with key super-secret-key-12345');
  });

  it('should produce deterministic tokens for the same input', () => {
    const { content: first } = redactor.redact('email: test@foo.com');
    const { content: second } = redactor.redact('email: test@foo.com');

    // Same input → same hash → same token
    expect(first).toBe(second);
  });

  it('should handle non-object inputs gracefully', () => {
    const input = 'Call 192.168.0.1';
    const { content, hasRedacted } = redactor.redact(input);

    expect(hasRedacted).toBe(true);
    expect(content).toMatch(/^Call \[NETWORK_IP_[a-f0-9]{6}\]$/);
  });

  describe('cloud provider key detection', () => {
    it('should redact AWS access key IDs', () => {
      const input = 'key: AKIAIOSFODNN7EXAMPLE';
      const { content, hasRedacted } = redactor.redact(input);
      expect(hasRedacted).toBe(true);
      expect(content).toMatch(/\[AWS_KEY_[a-f0-9]{6}\]/);
      expect(content).not.toContain('AKIAIOSFODNN7EXAMPLE');
    });

    it('should redact GCP API keys', () => {
      const input = 'key: AIzaSyA1234567890abcdefghijklmnopqrstuv';
      const { content, hasRedacted } = redactor.redact(input);
      expect(hasRedacted).toBe(true);
      expect(content).toMatch(/\[GCP_KEY_[a-f0-9]{6}\]/);
    });

    it('should redact GitHub PATs', () => {
      const input = 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
      const { content, hasRedacted } = redactor.redact(input);
      expect(hasRedacted).toBe(true);
      expect(content).toMatch(/\[GITHUB_PAT_[a-f0-9]{6}\]/);
    });

    it('should redact GitHub fine-grained PATs', () => {
      const input = 'github_pat_1234567890abcdefghijkl_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456';
      const { content, hasRedacted } = redactor.redact(input);
      expect(hasRedacted).toBe(true);
      expect(content).toMatch(/\[GITHUB_FINE_PAT_[a-f0-9]{6}\]/);
    });

    it('should redact GitLab PATs', () => {
      const input = 'token: glpat-1234567890abcdefghij';
      const { content, hasRedacted } = redactor.redact(input);
      expect(hasRedacted).toBe(true);
      expect(content).toMatch(/\[GITLAB_PAT_[a-f0-9]{6}\]/);
    });

    it('should redact Slack bot tokens', () => {
      const input = 'xoxb-1234567890123-1234567890123-abc';
      const { content, hasRedacted } = redactor.redact(input);
      expect(hasRedacted).toBe(true);
      expect(content).toMatch(/\[SLACK_BOT_[a-f0-9]{6}\]/);
    });

    it('should redact Stripe secret keys', () => {
      // Concatenated to avoid GitHub push-protection false positive
      const input = 'sk_live_' + '1234567890abcdefghijklmnop';
      const { content, hasRedacted } = redactor.redact(input);
      expect(hasRedacted).toBe(true);
      expect(content).toMatch(/\[STRIPE_SECRET_[a-f0-9]{6}\]/);
    });

    it('should redact SendGrid API keys', () => {
      // Concatenated to avoid GitHub push-protection false positive
      const input = 'SG.' + 'abcdefghijklmnopqrstuv.yz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ01234';
      const { content, hasRedacted } = redactor.redact(input);
      expect(hasRedacted).toBe(true);
      expect(content).toMatch(/\[SENDGRID_KEY_[a-f0-9]{6}\]/);
    });

    it('should redact npm tokens', () => {
      const input = 'npm_abcdefghijklmnopqrstuvwxyz0123456789';
      const { content, hasRedacted } = redactor.redact(input);
      expect(hasRedacted).toBe(true);
      expect(content).toMatch(/\[NPM_TOKEN_[a-f0-9]{6}\]/);
    });

    it('should redact Anthropic API keys', () => {
      const input = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
      const { content, hasRedacted } = redactor.redact(input);
      expect(hasRedacted).toBe(true);
      expect(content).toMatch(/\[ANTHROPIC_KEY_[a-f0-9]{6}\]/);
    });

    it('should redact DigitalOcean PATs', () => {
      const input = 'dop_v1_' + 'a'.repeat(64);
      const { content, hasRedacted } = redactor.redact(input);
      expect(hasRedacted).toBe(true);
      expect(content).toMatch(/\[DIGITALOCEAN_TOKEN_[a-f0-9]{6}\]/);
    });

    it('should redact PEM private keys', () => {
      const input = '-----BEGIN RSA PRIVATE KEY-----\n' + 'A'.repeat(100) + '\n-----END RSA PRIVATE KEY-----';
      const { content, hasRedacted } = redactor.redact(input);
      expect(hasRedacted).toBe(true);
      expect(content).toMatch(/\[PRIVATE_KEY_[a-f0-9]{6}\]/);
      expect(content).not.toContain('BEGIN RSA PRIVATE KEY');
    });

    it('should not false-positive on normal text', () => {
      const input = 'The package.json file has scripts and dependencies.';
      const { hasRedacted } = redactor.redact(input);
      expect(hasRedacted).toBe(false);
    });
  });
});
