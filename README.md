<p align="center">
  <img src="logo.svg" width="400" alt="hush Logo" />
</p>

**hush** is a Semantic Security Gateway for AI agents.
It acts as a local proxy between your AI tools (like Claude Code, Codex, OpenCode, Gemini CLI) and LLM providers (Anthropic, OpenAI, Google, ZhipuAI).

Hush ensures that sensitive data — like emails, IP addresses, and secrets — never leaves your machine by redacting it from prompts and tool outputs before they hit the cloud.

One gateway instance handles **all providers simultaneously** via path-based auto-detection.

## Why Hush?

When an AI agent runs a local tool (like `snow` or `ls`), it often returns PII (Personally Identifiable Information) to the terminal. Without Hush, this sensitive data is sent directly to the LLM provider for processing.

Hush intercepts this traffic, replaces PII with persistent tokens, and stores the original values in a local `TokenVault`.

## Features

- **Semantic Redaction:** Automatically identifies and masks PII (emails, IPs, secrets, credit cards) using high-entropy random tokens (e.g., `[HUSH_EML_8a2b3c]`).
- **Local Rehydration:** Automatically restores original values in the LLM's response locally. You see the real data; the cloud provider only sees tokens.
- **Live Protection Dashboard:** Run with `--dashboard` to see a real-time TUI showing PII being blocked and intercepted.
- **Zero-Trust Architecture:** Local-only processing. PII never leaves your machine. Bindings default to `127.0.0.1`.
- **Streaming Support:** Robust rehydration for SSE (Server-Sent Events) even when tokens are split across network chunks.

## Supported Tools

| Tool | Route | Auth Header |
|------|-------|-------------|
| Claude Code | `/v1/messages` | `x-api-key` or `Authorization` |
| Codex (OpenAI) | `/v1/chat/completions` | `Authorization` |
| OpenCode (ZhipuAI GLM-5) | `/api/paas/v4/chat/completions` | `Authorization` |
| Gemini CLI | `/v1beta/models/*` | `x-goog-api-key` |
| Any other | catch-all → Google | passthrough |

## Getting Started

### Installation

```bash
npm install -g @aictrl/hush
```

### Quick Start

Start the gateway once, then point any tool at it:

```bash
# Terminal 1: Start Hush
hush --dashboard

# Terminal 2: Claude Code
ANTHROPIC_API_KEY=sk-ant-... ANTHROPIC_BASE_URL=http://127.0.0.1:4000 claude

# Terminal 3: Codex
OPENAI_API_KEY=sk-... OPENAI_BASE_URL=http://127.0.0.1:4000/v1 codex

# Terminal 4: Gemini CLI
export GOOGLE_GENERATIVE_AI_BASE_URL=http://127.0.0.1:4000
export CODE_ASSIST_ENDPOINT=http://127.0.0.1:4000
```

### Authentication

Each tool authenticates with its **provider's API key**. Hush forwards auth headers transparently to the upstream provider.

> **Note on Claude Code subscriptions:** Claude Code subscription (OAuth) tokens are
> [not supported by Anthropic for third-party proxy use](https://github.com/anthropics/claude-code/issues/28091).
> You need an **API key** from the [Anthropic Console](https://console.anthropic.com/) to use Claude Code through Hush.
> Set `ANTHROPIC_API_KEY` in the terminal where you run `claude` — this overrides subscription auth.
>
> This is an upstream Anthropic limitation that affects all LLM proxies and gateways (LiteLLM, etc.), not just Hush.

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | The port the gateway listens on. | `4000` |
| `HUSH_HOST` | The host interface to bind to. | `127.0.0.1` |
| `HUSH_AUTH_TOKEN` | If set, the proxy requires `x-hush-token` or `Authorization: Bearer <token>` for access. | `undefined` |
| `HUSH_DASHBOARD` | Set to `true` to enable the TUI dashboard. | `false` |
| `DEBUG` | Set to `true` to expose vault size in `/health`. | `false` |

## How it Works

1.  **Intercept:** Hush sits locally on your machine as an HTTP proxy.
2.  **Redact:** Before a request is forwarded to Anthropic/OpenAI, Hush scans the message content for sensitive data and swaps it for tokens (e.g., `[USER_EMAIL_1]`).
3.  **Vault:** The original data is saved in a local, in-memory `TokenVault`.
4.  **Forward:** The redacted request is sent to the LLM provider.
5.  **Rehydrate:** When the LLM responds, Hush re-inserts the original values from the vault before showing the response to you.

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
git clone https://github.com/aictrl-dev/hush.git
cd hush
npm install
```

### Testing

```bash
npm test
```

### Building

```bash
npm run build
```

## Contributing

We welcome contributions! Please see our [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
