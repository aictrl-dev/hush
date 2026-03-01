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
    expect(content.email).toBe('[USER_EMAIL_1]');
    expect(content.ipv4).toBe('[NETWORK_IP_2]');
    expect(content.ipv6).toBe('[NETWORK_IP_V6_3]');
    expect(content.config.apiKey).toContain('[SENSITIVE_SECRET_4]');
    expect(content.config.secretToken).toContain('[SENSITIVE_SECRET_5]');
    expect(content.message).toContain('[USER_EMAIL_6]');
    expect(content.message).toContain('[NETWORK_IP_7]');
    expect(tokens.size).toBe(7);
  });

  it('should redact credit card numbers', () => {
    const input = 'My card is 4111-1111-1111-1111 and it expires soon';
    const { content, hasRedacted } = redactor.redact(input);

    expect(hasRedacted).toBe(true);
    expect(content).toBe('My card is [PAYMENT_CARD_1] and it expires soon');
  });

  it('should redact phone numbers including complex formats', () => {
    const input = 'Call me at 555-010-0199 or +1 (555) 123-4567. UK: +44 20 7946 0958';
    const { content, hasRedacted } = redactor.redact(input);

    expect(hasRedacted).toBe(true);
    expect(content).toContain('[PHONE_NUMBER_1]');
    expect(content).toContain('[PHONE_NUMBER_2]');
    expect(content).toContain('[PHONE_NUMBER_3]');
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

    expect(redacted.user).toBe('[USER_EMAIL_1]');
    expect(redacted.key).toContain('[SENSITIVE_SECRET_2]');

    // 2. Simulate result containing tokens coming back (e.g., from logs or agent output)
    const resultWithTokens = { 
      status: 'Success',
      log: 'Processing request for [USER_EMAIL_1] with key [SENSITIVE_SECRET_2]' 
    };

    // 3. Re-hydrate locally for developer visibility
    const finalResult = vault.rehydrate(resultWithTokens);

    expect(finalResult.log).toBe('Processing request for bulat@aictrl.dev with key super-secret-key-12345');
  });

  it('should handle non-object inputs gracefully', () => {
    const input = 'Call 192.168.0.1';
    const { content, hasRedacted } = redactor.redact(input);
    
    expect(hasRedacted).toBe(true);
    expect(content).toBe('Call [NETWORK_IP_1]');
  });
});
