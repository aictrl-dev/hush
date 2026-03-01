<p align="center">
  <img src="logo.svg" width="400" alt="hush Logo" />
</p>

**hush** is a Semantic Security Gateway for AI agents.
 It acts as a local proxy between your AI tools (like Claude Code, Cursor, or custom CLI agents) and LLM providers (Anthropic, OpenAI).

Hush ensures that sensitive data—like emails, IP addresses, and secrets—never leaves your machine by redacting it from prompts and tool outputs before they hit the cloud.

## Why Hush?

When an AI agent runs a local tool (like `snow` or `ls`), it often returns PII (Personally Identifiable Information) to the terminal. Without Hush, this sensitive data is sent directly to the LLM provider for processing.

Hush intercepts this traffic, replaces PII with persistent tokens, and stores the original values in a local `TokenVault`.

## Features

- **Semantic Redaction:** Automatically identifies and masks PII (emails, IPs, secrets, credit cards) using high-entropy random tokens (e.g., `[HUSH_EML_8a2b3c]`).
- **Local Rehydration:** Automatically restores original values in the LLM's response locally. You see the real data; the cloud provider only sees tokens.
- **Live Protection Dashboard:** Run with `--dashboard` to see a real-time TUI showing PII being blocked and intercepted.
- **Zero-Trust Architecture:** Local-only processing. PII never leaves your machine. Bindings default to `127.0.0.1`.
- **Streaming Support:** Robust rehydration for SSE (Server-Sent Events) even when tokens are split across network chunks.

## Getting Started

### Installation

```bash
npm install -g @aictrl/hush
```

### Usage

1.  **Start the hush Gateway:**
    ```bash
    hush --dashboard
    ```
    hush will start listening on `http://127.0.0.1:4000`.

2.  **Point your AI tool to the Gateway:**

    For **Claude Code**:
    ```bash
    export ANTHROPIC_BASE_URL=http://127.0.0.1:4000
    claude
    ```

    For **OpenAI-based tools**:
    ```bash
    export OPENAI_BASE_URL=http://127.0.0.1:4000
    ```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | The port the gateway listens on. | `4000` |
| `HUSH_HOST` | The host interface to bind to. | `127.0.0.1` |
| `HUSH_AUTH_TOKEN` | If set, the proxy requires `Authorization: Bearer <token>` | `undefined` |
| `HUSH_DASHBOARD` | Set to `true` to enable the TUI dashboard. | `false` |

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
