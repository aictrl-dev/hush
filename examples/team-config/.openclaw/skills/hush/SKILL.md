# Hush PII Guard 🛡️

**Hush PII Guard** is a safety skill for OpenClaw that prevents sensitive data from being sent to AI models or leaking through tool outputs.

## What it blocks
| Tool | Blocked when |
|------|-------------|
| `read` | File path matches `.env*`, `*credentials*`, `*secret*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.asc`, `id_rsa*`, `.netrc`, `.pgpass` |
| `bash` | Commands like `cat`, `head`, `tail`, `less`, `more`, `bat` target a sensitive file |

## What it redacts
The skill automatically scans the output of every tool (Bash stdout/stderr, file reads, etc.) for:
- 📧 Emails
- 🌐 IP Addresses
- 🔑 API Keys & Secrets
- 💳 Credit Card Numbers
- 📞 Phone Numbers

Sensitive data is replaced with deterministic tokens like `[USER_EMAIL_f22c5a]`.

## Setup
1. Copy this directory to `~/.openclaw/workspace/skills/hush/`.
2. Ensure `hush` is installed globally: `npm install -g @aictrl/hush`.
3. OpenClaw will automatically discover and load the skill from your workspace.

## Defense-in-depth
For maximum protection, use this skill alongside the **Hush Proxy**. The skill protects your local files, while the proxy redacts PII from API requests before they leave your machine.
