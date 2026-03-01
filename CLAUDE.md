# hush 🛡️ Mandates

## Development Workflow
- **PR-Only Pushes:** All code changes, documentation updates, and asset additions MUST be submitted via a Pull Request. Direct pushes to the `master` branch are strictly prohibited.
- **CI/CD Verification:** Every PR must have passing CI/CD status checks before it can be considered for merging. You MUST manually verify these checks via `gh pr checks` or equivalent.
- **No Automatic Merges:** You MUST NOT merge a Pull Request automatically. Once CI passes and the work is verified, you must ask the user for final approval before merging to `master`.
- **Security First:** Never bypass security protocols (like `HUSH_AUTH_TOKEN` or local binding) during development or testing.
