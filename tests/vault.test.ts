import { describe, it, expect, vi } from 'vitest';
import { TokenVault } from '../src/vault/token-vault';

describe('TokenVault TTL and Pruning', () => {
  it('should expire tokens after TTL', async () => {
    // Set a very short TTL: 100ms
    const vault = new TokenVault(100);
    const tokens = new Map([['[TOKEN_1]', 'secret-value']]);

    vault.saveTokens(tokens);
    expect(vault.get('[TOKEN_1]')).toBe('secret-value');

    // Fast-forward time by 150ms
    vi.useFakeTimers();
    vi.advanceTimersByTime(150);

    // Pruning happens during the next save
    vault.saveTokens(new Map([['[TOKEN_2]', 'other-value']]));

    expect(vault.get('[TOKEN_1]')).toBeUndefined();
    expect(vault.get('[TOKEN_2]')).toBe('other-value');
    
    vi.useRealTimers();
  });

  it('should rehydrate using non-expired tokens', () => {
    const vault = new TokenVault(1000);
    const tokens = new Map([['[TOKEN_1]', 'bulat@aictrl.dev']]);
    vault.saveTokens(tokens);

    const input = 'Hello [TOKEN_1]';
    expect(vault.rehydrate(input)).toBe('Hello bulat@aictrl.dev');
  });
});

describe('StreamingRehydrator', () => {
  it('should rehydrate tokens split across chunks', () => {
    const vault = new TokenVault();
    vault.saveTokens(new Map([['[HUSH_EML_1234]', 'test@example.com']]));
    
    const rehydrator = vault.createStreamingRehydrator();
    
    // Chunk 1: Ends mid-token
    const chunk1 = 'My email is [HUSH_E';
    expect(rehydrator(chunk1)).toBe('My email is ');

    // Chunk 2: Completes token and adds more text
    const chunk2 = 'ML_1234] and more.';
    expect(rehydrator(chunk2)).toBe('test@example.com and more.');
  });

  it('should handle multiple tokens and partial starts', () => {
    const vault = new TokenVault();
    vault.saveTokens(new Map([
      ['[HUSH_SEC_1]', 'secret-1'],
      ['[HUSH_SEC_2]', 'secret-2']
    ]));

    const rehydrator = vault.createStreamingRehydrator();

    expect(rehydrator('Part 1: [HU')).toBe('Part 1: ');
    expect(rehydrator('SH_SEC_1] and [')).toBe('secret-1 and ');
    expect(rehydrator('HUSH_SEC_2] done.')).toBe('secret-2 done.');
  });

  it('should release non-token text immediately', () => {
    const vault = new TokenVault();
    const rehydrator = vault.createStreamingRehydrator();

    expect(rehydrator('Hello World. ')).toBe('Hello World. ');
    expect(rehydrator('No tokens here.')).toBe('No tokens here.');
  });
});
