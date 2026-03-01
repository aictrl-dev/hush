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
