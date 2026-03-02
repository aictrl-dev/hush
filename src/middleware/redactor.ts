/**
 * Semantic Redactor Middleware
 *
 * Identifies and swaps PII (emails, keys, IP addresses) for persistent tokens.
 * Interoperable with TokenVault for re-hydration.
 */

import { createHash } from 'crypto';

/** Deterministic short hash of a value (first 6 hex chars of SHA-256). */
function tokenHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 6);
}

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
    /** Email regex (ReDoS-safe: single character class with no nested quantifiers) */
    EMAIL: /\b[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,253}\.[a-zA-Z]{2,63}\b/g,
    /** IPv4 address regex */
    IPV4: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    /** IPv6 address regex */
    IPV6: /(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))/g,
    /** Generic API Key / Secret pattern (robust version) */
    SECRET: /(?:api[-_]?key|secret|password|token|bearer|auth)["']?\s*[:=]\s*["']?([a-zA-Z0-9\-_!@#$%^&*()=+]{16,})["']?/gi,
    /** Credit Card (basic) */
    CREDIT_CARD: /\b(?:\d[ -]*?){13,16}\b/g,
    /** Phone Numbers (robust version) */
    PHONE: /(?:^|[\s:;])(?:\+\d{1,3}[-. ]?)?\(?\d{2,4}\)?[-. ]\d{3,4}[-. ]\d{3,4}(?:\s*(?:ext|x)\s*\d+)?/g,
  };

  /**
   * Cloud provider key patterns — Tier 1 only (unique prefixes, very low false-positive risk).
   * Sources: GitHub secret scanning, gitleaks, trufflehog.
   */
  private static readonly CLOUD_KEY_PATTERNS: Array<{ re: RegExp; label: string }> = [
    // AWS
    { re: /\b((?:AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b/g, label: 'AWS_KEY' },
    // GCP / Firebase
    { re: /\b(AIza[\w-]{35})\b/g, label: 'GCP_KEY' },
    { re: /\b(GOCSPX-[a-zA-Z0-9_-]{28})\b/g, label: 'GCP_OAUTH' },
    // GitHub
    { re: /\b(ghp_[0-9a-zA-Z]{36})\b/g, label: 'GITHUB_PAT' },
    { re: /\b(gho_[0-9a-zA-Z]{36})\b/g, label: 'GITHUB_OAUTH' },
    { re: /\b(ghu_[0-9a-zA-Z]{36})\b/g, label: 'GITHUB_U2S' },
    { re: /\b(ghs_[0-9a-zA-Z]{36})\b/g, label: 'GITHUB_S2S' },
    { re: /\b(ghr_[0-9a-zA-Z]{36})\b/g, label: 'GITHUB_REFRESH' },
    { re: /\b(github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59})\b/g, label: 'GITHUB_FINE_PAT' },
    // GitLab
    { re: /\b(glpat-[\w-]{20})\b/g, label: 'GITLAB_PAT' },
    { re: /\b(glptt-[a-zA-Z0-9_-]{40})\b/g, label: 'GITLAB_TRIGGER' },
    // Slack
    { re: /\b(xoxb-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*)\b/g, label: 'SLACK_BOT' },
    { re: /\b(xox[pe]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9-]+)\b/g, label: 'SLACK_TOKEN' },
    // Stripe
    { re: /\b(sk_(?:live|test)_[a-zA-Z0-9]{10,99})\b/g, label: 'STRIPE_SECRET' },
    { re: /\b(rk_(?:live|test)_[a-zA-Z0-9]{10,99})\b/g, label: 'STRIPE_RESTRICTED' },
    { re: /\b(whsec_[a-zA-Z0-9]{24,})\b/g, label: 'STRIPE_WEBHOOK' },
    // SendGrid (SG. + base64url with internal dot separator)
    { re: /\b(SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43})\b/g, label: 'SENDGRID_KEY' },
    // npm
    { re: /\b(npm_[a-z0-9]{36})\b/gi, label: 'NPM_TOKEN' },
    // PyPI
    { re: /\b(pypi-AgEIcHlwaS5vcmc[\w-]{50,})\b/g, label: 'PYPI_TOKEN' },
    // Docker Hub
    { re: /\b(dckr_pat_[a-zA-Z0-9_-]{27,})\b/g, label: 'DOCKER_PAT' },
    // Anthropic
    { re: /\b(sk-ant-[a-zA-Z0-9_-]{36,})\b/g, label: 'ANTHROPIC_KEY' },
    // OpenAI (with T3BlbkFJ marker)
    { re: /\b(sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,})\b/g, label: 'OPENAI_KEY' },
    // DigitalOcean
    { re: /\b(do[por]_v1_[a-f0-9]{64})\b/g, label: 'DIGITALOCEAN_TOKEN' },
    // HashiCorp Vault
    { re: /\b(hvs\.[\w-]{90,})\b/g, label: 'VAULT_TOKEN' },
    { re: /\b(hvb\.[\w-]{90,})\b/g, label: 'VAULT_BATCH' },
    // Supabase
    { re: /\b(sbp_[a-f0-9]{40})\b/g, label: 'SUPABASE_PAT' },
    { re: /\b(sb_secret_[a-zA-Z0-9_-]{20,})\b/g, label: 'SUPABASE_SECRET' },
    // PEM private keys (multiline — matched separately in redactPEMKeys)
  ];

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
          const token = `[SENSITIVE_SECRET_${tokenHash(node)}]`;
          tokens.set(token, node);
          return token;
        }
      }

      if (typeof node === 'string') {
        let text = node;

        // Redact Emails
        text = text.replace(Redactor.PATTERNS.EMAIL, (match) => {
          hasRedacted = true;
          const token = `[USER_EMAIL_${tokenHash(match)}]`;
          tokens.set(token, match);
          return token;
        });

        // Redact IP Addresses (v4)
        text = text.replace(Redactor.PATTERNS.IPV4, (match) => {
          hasRedacted = true;
          const token = `[NETWORK_IP_${tokenHash(match)}]`;
          tokens.set(token, match);
          return token;
        });

        // Redact IP Addresses (v6)
        text = text.replace(Redactor.PATTERNS.IPV6, (match) => {
          hasRedacted = true;
          const token = `[NETWORK_IP_V6_${tokenHash(match)}]`;
          tokens.set(token, match);
          return token;
        });

        // Redact cloud provider keys BEFORE generic patterns — specific prefixed
        // keys must be matched first so they don't get partially eaten by SECRET
        // or CREDIT_CARD patterns.
        for (const { re, label } of Redactor.CLOUD_KEY_PATTERNS) {
          re.lastIndex = 0;
          text = text.replace(re, (match, p1: string) => {
            hasRedacted = true;
            const val = p1 || match;
            const token = `[${label}_${tokenHash(val)}]`;
            tokens.set(token, val);
            return token;
          });
        }

        // Redact PEM private keys
        text = text.replace(
          /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY-----[\s\S]{64,}?-----END[ A-Z0-9_-]{0,100}PRIVATE KEY-----/g,
          (match) => {
            hasRedacted = true;
            const token = `[PRIVATE_KEY_${tokenHash(match)}]`;
            tokens.set(token, match);
            return token;
          },
        );

        // Redact Secrets in text (e.g. "api_key=...")
        text = text.replace(Redactor.PATTERNS.SECRET, (match, p1) => {
          hasRedacted = true;
          const token = `[SENSITIVE_SECRET_${tokenHash(p1)}]`;
          tokens.set(token, p1);
          return match.replace(p1, token);
        });

        // Redact Credit Cards
        text = text.replace(Redactor.PATTERNS.CREDIT_CARD, (match) => {
          hasRedacted = true;
          const token = `[PAYMENT_CARD_${tokenHash(match)}]`;
          tokens.set(token, match);
          return token;
        });

        // Redact Phone Numbers
        text = text.replace(Redactor.PATTERNS.PHONE, (match) => {
          hasRedacted = true;
          const token = `[PHONE_NUMBER_${tokenHash(match)}]`;
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
