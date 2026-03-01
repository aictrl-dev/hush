# hush 🛡️ Mandates

## Development Workflow
- **PR-Only Pushes:** All code changes, documentation updates, and asset additions MUST be submitted via a Pull Request. Direct pushes to the `master` branch are strictly prohibited.
- **Verification:** Every PR must pass all existing tests (`npm test`) and maintain or improve the current test coverage before merging.
- **Security First:** Never bypass security protocols (like `HUSH_AUTH_TOKEN` or local binding) during development or testing.
