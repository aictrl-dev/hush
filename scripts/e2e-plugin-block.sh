#!/usr/bin/env bash
#
# E2E Scenario A: OpenCode hush plugin blocks .env read
#
# Verifies that the hush plugin's tool.execute.before hook prevents
# the AI model from ever reading sensitive files. The model should
# receive a "blocked" error instead of the file contents.
#
# Usage: ./scripts/e2e-plugin-block.sh
# Requirements: opencode CLI, node

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
TMPDIR=""

cleanup() {
  echo ""
  echo -e "${CYAN}Cleaning up...${NC}"
  [ -n "$TMPDIR" ] && rm -rf "$TMPDIR"
}
trap cleanup EXIT

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo -e "  ${GREEN}PASS${NC} $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo -e "  ${RED}FAIL${NC} $1"
}

assert_contains() {
  local haystack="$1" needle="$2" msg="$3"
  if echo "$haystack" | grep -qiF "$needle"; then
    pass "$msg"
  else
    fail "$msg (expected to find '$needle')"
  fi
}

assert_not_contains() {
  local haystack="$1" needle="$2" msg="$3"
  if echo "$haystack" | grep -qiF "$needle"; then
    fail "$msg (found '$needle' which should have been blocked)"
  else
    pass "$msg"
  fi
}

echo -e "${CYAN}================================================${NC}"
echo -e "${CYAN}  E2E Scenario A: Plugin Blocks .env Read       ${NC}"
echo -e "${CYAN}================================================${NC}"
echo ""

# --- Step 1: Create temp project with .env and hush plugin ---
echo -e "${YELLOW}[1/4] Creating temp project with .env and hush plugin...${NC}"

TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/.opencode/plugins"

# Sensitive .env file with PII
cat > "$TMPDIR/.env" <<'ENVEOF'
DATABASE_URL=postgres://admin:supersecret@10.42.99.7:5432/prod
API_KEY=sk-live-a1b2c3d4e5f6g7h8i9j0k1l2m3n4
ADMIN_EMAIL=alice@confidential-corp.com
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
ENVEOF

# Copy the drop-in plugin
cp "$PROJECT_DIR/examples/team-config/.opencode/plugins/hush.ts" \
   "$TMPDIR/.opencode/plugins/hush.ts"

# opencode.json — point at real provider + enable plugin
cat > "$TMPDIR/opencode.json" <<OCEOF
{
  "provider": {
    "zai-coding-plan": {
      "options": {
        "baseURL": "https://open.bigmodel.cn/api/coding/paas/v4"
      }
    }
  },
  "plugin": [".opencode/plugins/hush.ts"]
}
OCEOF

echo -e "  Temp project: ${TMPDIR}"
echo -e "  .env contains: email, API key, DB URL, AWS secret"

# --- Step 2: Run OpenCode with prompt to read .env ---
echo ""
echo -e "${YELLOW}[2/4] Running OpenCode: 'read the file .env and tell me what's in it'...${NC}"

cd "$TMPDIR"
OUTPUT=$(opencode -p "read the file .env and tell me what's in it" -q -f json 2>&1) || true
echo -e "  Output length: $(echo "$OUTPUT" | wc -c) bytes"

# --- Step 3: Verify plugin blocked the read ---
echo ""
echo -e "${YELLOW}[3/4] Verifying plugin blocked .env read...${NC}"
echo ""

# The output should mention blocking/error, not contain the actual PII
assert_contains "$OUTPUT" "block" "Output mentions blocking"

# --- Step 4: Verify PII never appears in output ---
echo ""
echo -e "${YELLOW}[4/4] Verifying PII never appears in output...${NC}"
echo ""

assert_not_contains "$OUTPUT" "alice@confidential-corp.com" "Email not in output"
assert_not_contains "$OUTPUT" "sk-live-a1b2c3d4e5f6g7h8i9j0k1l2m3n4" "API key not in output"
assert_not_contains "$OUTPUT" "supersecret" "DB password not in output"
assert_not_contains "$OUTPUT" "wJalrXUtnFEMI" "AWS secret not in output"

# --- Summary ---
echo ""
echo -e "${CYAN}================================================${NC}"
TOTAL=$((PASS_COUNT + FAIL_COUNT))
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}  ALL ${TOTAL} CHECKS PASSED${NC}"
  echo ""
  echo -e "  ${GREEN}Plugin blocked .env read — PII never reached the model.${NC}"
else
  echo -e "${RED}  ${FAIL_COUNT}/${TOTAL} CHECKS FAILED${NC}"
fi
echo -e "${CYAN}================================================${NC}"

exit "$FAIL_COUNT"
