/**
 * Semantic Redactor Middleware
 *
 * Identifies and swaps PII (emails, keys, IP addresses) for persistent tokens.
 * Interoperable with TokenVault for re-hydration.
 */

/**
 * Result of a redaction operation.
 */
export interface RedactionResult {
  /** The redacted content (string or object) */
  content: any;
  /** Whether any redaction took place */
  hasRedacted: boolean;
  /** Map of tokens to their original values */
  tokens: Map<string, string>;
}

/**
 * Redactor class for identifying and masking sensitive information.
 */
export class Redactor {
  /**
   * Common PII Regex patterns.
   */
  private static readonly PATTERNS = {
    /** RFC 5322 compliant email regex */
    EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    /** IPv4 address regex */
    IPV4: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    /** IPv6 address regex */
    IPV6: /(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))/g,
    /** Generic API Key / Secret pattern */
    SECRET: /(?:api[-_]?key|secret|password|token|bearer|auth)["']?\s*[:=]\s*["']?([a-zA-Z0-9\-_]{16,})["']?/gi,
    /** Credit Card (basic) */
    CREDIT_CARD: /\b(?:\d[ -]*?){13,16}\b/g,
    /** Phone Numbers (common international and US formats) */
    PHONE: /(?:\+\d{1,3}[- ]?)?\(?\d{2,3}\)?[- ]?\d{3,4}[- ]?\d{4}/g,
  };

  /**
   * Redact sensitive information from a JSON object or string.
   * 
   * @param input - The string or object to redact.
   * @returns A RedactionResult containing the masked content and the token map.
   */
  public redact(input: any): RedactionResult {
    const tokens = new Map<string, string>();
    let hasRedacted = false;

    // Deep copy input for safe modification if it's an object
    const output = typeof input === 'object' && input !== null 
      ? JSON.parse(JSON.stringify(input)) 
      : input;

    const SENSITIVE_KEYS = ['apikey', 'secret', 'password', 'token', 'bearer', 'auth', 'credential'];

    const process = (node: any, keyName?: string): any => {
      // Check if the current key is sensitive
      if (keyName && typeof node === 'string') {
        const normalizedKey = keyName.toLowerCase().replace(/[-_]/g, '');
        if (SENSITIVE_KEYS.some(k => normalizedKey.includes(k))) {
          hasRedacted = true;
          const token = `[SENSITIVE_SECRET_${tokens.size + 1}]`;
          tokens.set(token, node);
          return token;
        }
      }

      if (typeof node === 'string') {
        let text = node;

        // Redact Emails
        text = text.replace(Redactor.PATTERNS.EMAIL, (match) => {
          hasRedacted = true;
          const token = `[USER_EMAIL_${tokens.size + 1}]`;
          tokens.set(token, match);
          return token;
        });

        // Redact IP Addresses (v4)
        text = text.replace(Redactor.PATTERNS.IPV4, (match) => {
          hasRedacted = true;
          const token = `[NETWORK_IP_${tokens.size + 1}]`;
          tokens.set(token, match);
          return token;
        });

        // Redact IP Addresses (v6)
        text = text.replace(Redactor.PATTERNS.IPV6, (match) => {
          hasRedacted = true;
          const token = `[NETWORK_IP_V6_${tokens.size + 1}]`;
          tokens.set(token, match);
          return token;
        });

        // Redact Secrets in text (e.g. "api_key=...")
        text = text.replace(Redactor.PATTERNS.SECRET, (match, p1) => {
          hasRedacted = true;
          const token = `[SENSITIVE_SECRET_${tokens.size + 1}]`;
          tokens.set(token, p1);
          return match.replace(p1, token);
        });

        // Redact Credit Cards
        text = text.replace(Redactor.PATTERNS.CREDIT_CARD, (match) => {
          hasRedacted = true;
          const token = `[PAYMENT_CARD_${tokens.size + 1}]`;
          tokens.set(token, match);
          return token;
        });

        // Redact Phone Numbers
        text = text.replace(Redactor.PATTERNS.PHONE, (match) => {
          hasRedacted = true;
          const token = `[PHONE_NUMBER_${tokens.size + 1}]`;
          tokens.set(token, match);
          return token;
        });

        return text;
      }

      if (Array.isArray(node)) {
        return node.map(item => process(item));
      }

      if (node !== null && typeof node === 'object') {
        const obj: any = {};
        for (const [key, value] of Object.entries(node)) {
          obj[key] = process(value, key);
        }
        return obj;
      }

      return node;
    };

    const redactedContent = process(output);

    return {
      content: redactedContent,
      hasRedacted,
      tokens
    };
  }
}
