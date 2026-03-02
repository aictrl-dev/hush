<p align="center">
  <img src="logo.svg" width="400" alt="hush Logo" />
</p>

**hush** is a Semantic Security Gateway for AI agents.
It sits between your AI tools (Claude Code, Codex, OpenCode, Gemini CLI) and LLM providers, ensuring that sensitive data — emails, IP addresses, API keys, credit cards — never leaves your machine.

## Quick Start

```bash
npm install -g @aictrl/hush
hush
```

Hush starts on `http://127.0.0.1:4000`. Now point your AI tool at it:

### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:4000"
  }
}
```

> **Note:** Claude Code subscription (OAuth) tokens are currently blocked by Anthropic for third-party proxies ([anthropics/claude-code#28091](https://github.com/anthropics/claude-code/issues/28091)). If you hit a 401, add `"ANTHROPIC_AUTH_TOKEN": "sk-ant-..."` to the env block above.

### Codex (OpenAI)

Add to `~/.codex/config.toml` (or `.codex/config.toml` in your project):

```toml
model_provider = "hush"

[model_providers.hush]
base_url = "http://127.0.0.1:4000/v1"
```

### OpenCode (ZhipuAI GLM-5)

Create `opencode.json` in your project root:

```json
{
  "provider": {
    "zai-coding-plan": {
      "options": {
        "baseURL": "http://127.0.0.1:4000/api/coding/paas/v4"
      }
    }
  }
}
```

### Gemini CLI

Add `.gemini/.env` to your project root (or set the env var directly):

```bash
# .gemini/.env
CODE_ASSIST_ENDPOINT=http://127.0.0.1:4000
```

Or: `CODE_ASSIST_ENDPOINT=http://127.0.0.1:4000 gemini`

### Verify it works

When your AI tool sends a request containing PII, the hush terminal shows:

```
INFO: Redacted sensitive data from request  path="/v1/messages"  tokenCount=2  duration=1
```

Your tool still sees the real data (rehydrated locally). The LLM provider only ever sees tokens like `[USER_EMAIL_f22c5a]`.

## Enforce for Your Team

Commit config files to your repo so every developer automatically routes through hush — no manual setup per person.

Copy the files from [`examples/team-config/`](examples/team-config/) into your project root:

```
your-project/
├── .claude/settings.json     # Claude Code → hush
├── .codex/config.toml        # Codex → hush
├── .gemini/.env              # Gemini CLI → hush
└── opencode.json             # OpenCode → hush
```

**Claude Code** — `.claude/settings.json`:
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:4000"
  }
}
```

**Codex** — `.codex/config.toml`:
```toml
model_provider = "hush"

[model_providers.hush]
base_url = "http://127.0.0.1:4000/v1"
```

**OpenCode** — `opencode.json`:
```json
{
  "provider": {
    "zai-coding-plan": {
      "options": {
        "baseURL": "http://127.0.0.1:4000/api/coding/paas/v4"
      }
    }
  }
}
```

**Gemini CLI** — `.gemini/.env`:
```
CODE_ASSIST_ENDPOINT=http://127.0.0.1:4000
```

Each developer just needs `hush` running locally. All AI tools in the project will route through it automatically.

## Hooks Mode (Claude Code)

Hush can also run as a **Claude Code hook** — redacting PII from tool outputs *before Claude ever sees them*. No proxy required.

### Setup

```bash
hush init --hooks
```

This adds a `PostToolUse` hook to `.claude/settings.json` that runs `hush redact-hook` after every `Bash`, `Read`, `Grep`, and `WebFetch` tool call.

Use `--local` to write to `settings.local.json` instead (for personal overrides not committed to the repo).

### How it works

```
Local files/commands → [Hook: redact before Claude sees] → Claude's context
                                                               ↓
                                                          API request
                                                               ↓
                                                    [Proxy: redact before cloud]
                                                               ↓
                                                          LLM Provider
```

When a tool runs (e.g., `cat .env`), the hook intercepts the output, scans for PII, and replaces it with tokens before Claude processes it. Claude only ever sees `[USER_EMAIL_f22c5a]`, not `alice@company.com`.

### Hooks vs Proxy

| | Hooks Mode | Proxy Mode |
|---|---|---|
| **What's protected** | Tool outputs (before Claude sees them) | API requests (before they leave your machine) |
| **Setup** | `hush init --hooks` | `hush` + point `ANTHROPIC_BASE_URL` |
| **Works with** | Claude Code only | Any AI tool |
| **Defense-in-depth** | Use both for maximum coverage | Use both for maximum coverage |

### Defense-in-depth

For maximum protection, use both modes together. The team config example in [`examples/team-config/`](examples/team-config/) shows this setup — hooks redact tool outputs and the proxy redacts API requests.

## How it Works

1. **Intercept** — Hush sits on your machine between your AI tool and the LLM provider.
2. **Redact** — Before forwarding, it scans for PII and swaps it for deterministic tokens (`bulat@aictrl.dev` → `[USER_EMAIL_f22c5a]`).
3. **Vault** — Original values are saved in a local, in-memory TokenVault (auto-expires after 1 hour).
4. **Forward** — The redacted request goes to the provider. They never see your real data.
5. **Rehydrate** — Responses come back with tokens replaced by originals before reaching your tool.

## Supported Tools

| Tool | Config | Route |
|------|--------|-------|
| Claude Code | `~/.claude/settings.json` | `/v1/messages` → Anthropic |
| Codex | `~/.codex/config.toml` | `/v1/chat/completions` → OpenAI |
| OpenCode | `opencode.json` | `/api/paas/v4/**` → ZhipuAI |
| Gemini CLI | `.gemini/.env` | `/v1beta/models/**` → Google |
| Any tool | Point base URL at hush | `/*` catch-all with auto-detect |

Hush forwards your existing auth headers transparently — no API keys need to be reconfigured.

## Features

- **Semantic Redaction** — Identifies emails, IPs, secrets, credit cards, phone numbers. Deterministic hash-based tokens (same input → same token).
- **Local Rehydration** — Restores original values in responses locally. You see real data; the provider sees tokens.
- **Streaming Support** — SSE-aware rehydration handles tokens split across network chunks.
- **Live Dashboard** — `hush --dashboard` for a real-time TUI showing PII being blocked.
- **Zero-Trust** — PII never leaves your machine. Binds to `127.0.0.1` by default.
- **Universal Proxy** — One instance handles all providers simultaneously. Auto-detects from request path.

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Gateway listen port | `4000` |
| `HUSH_HOST` | Bind address | `127.0.0.1` |
| `HUSH_AUTH_TOKEN` | Require auth on all requests to the gateway itself | — |
| `HUSH_DASHBOARD` | Enable TUI dashboard | `false` |
| `DEBUG` | Show vault size in `/health` | `false` |

## Development

```bash
git clone https://github.com/aictrl-dev/hush.git
cd hush && npm install
npm run dev        # dev mode with tsx
npm test           # run tests
npm run build      # production build
```

## License

Apache License 2.0 — see [LICENSE](LICENSE).
