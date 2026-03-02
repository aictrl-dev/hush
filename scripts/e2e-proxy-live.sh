#!/usr/bin/env bash
#
# E2E Scenario B: Proxy redacts PII from normal file reads
#
# A non-sensitive filename (config.txt) containing PII gets through the
# plugin's filename check. The hush proxy intercepts the API request and
# redacts PII before it reaches the LLM provider.
#
# Usage: ./scripts/e2e-proxy-live.sh
# Requirements: opencode CLI, node, npm (dependencies installed + built)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

GATEWAY_PORT=4000
GATEWAY_PID=""
PASS_COUNT=0
FAIL_COUNT=0
WORK_DIR=""

cleanup() {
  echo ""
  echo -e "${CYAN}Cleaning up...${NC}"
  [ -n "$GATEWAY_PID" ] && kill "$GATEWAY_PID" 2>/dev/null || true
  [ -n "$WORK_DIR" ] && rm -rf "$WORK_DIR"
  wait 2>/dev/null || true
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
    fail "$msg (found '$needle' which should have been redacted)"
  else
    pass "$msg"
  fi
}

wait_for_port() {
  local port=$1 label=$2 max_attempts=${3:-20}
  for i in $(seq 1 "$max_attempts"); do
    if curl -sf "http://127.0.0.1:${port}/health" > /dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo -e "${RED}${label} failed to start on :${port}${NC}"
  return 1
}

echo -e "${CYAN}================================================${NC}"
echo -e "${CYAN}  E2E Scenario B: Proxy Redacts PII in Normal   ${NC}"
echo -e "${CYAN}  File (Plugin Allows, Proxy Catches)           ${NC}"
echo -e "${CYAN}================================================${NC}"
echo ""

cd "$PROJECT_DIR"

# --- Step 1: Start Hush gateway ---
echo -e "${YELLOW}[1/5] Starting Hush gateway on :${GATEWAY_PORT}...${NC}"

PORT=$GATEWAY_PORT DEBUG=true node dist/cli.js > /tmp/hush-e2e-proxy.log 2>&1 &
GATEWAY_PID=$!

wait_for_port "$GATEWAY_PORT" "Gateway" || exit 1
echo -e "  Gateway PID: ${GATEWAY_PID}"

# --- Step 2: Create temp project with config.txt containing PII ---
echo -e "${YELLOW}[2/5] Creating temp project with config.txt (PII in normal file)...${NC}"

WORK_DIR=$(mktemp -d)
mkdir -p "$WORK_DIR/.opencode/plugins"

# Normal filename — plugin won't block this
cat > "$WORK_DIR/config.txt" <<'CFGEOF'
# Application Configuration
app_name: MyApp
admin_contact: alice@confidential-corp.com
server_ip: 10.42.99.7
api_key=sk-live-a1b2c3d4e5f6g7h8i9j0k1l2m3n4
log_level: info
CFGEOF

# Copy the hush plugin (it won't block config.txt — not a sensitive filename)
cp "$PROJECT_DIR/examples/team-config/.opencode/plugins/hush.ts" \
   "$WORK_DIR/.opencode/plugins/hush.ts"

# Point OpenCode at hush proxy
cat > "$WORK_DIR/opencode.json" <<OCEOF
{
  "provider": {
    "zai-coding-plan": {
      "options": {
        "baseURL": "http://127.0.0.1:${GATEWAY_PORT}/api/coding/paas/v4"
      }
    }
  },
  "plugin": [".opencode/plugins/hush.ts"]
}
OCEOF

echo -e "  Temp project: ${WORK_DIR}"

# --- Step 3: Check vault is empty before test ---
echo -e "${YELLOW}[3/5] Checking gateway vault is empty before test...${NC}"

HEALTH_BEFORE=$(curl -sf "http://127.0.0.1:${GATEWAY_PORT}/health")
VAULT_BEFORE=$(echo "$HEALTH_BEFORE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('vaultSize', 0))" 2>/dev/null || echo "0")
echo -e "  Vault size before: ${VAULT_BEFORE}"

# --- Step 4: Run OpenCode to read config.txt ---
echo -e "${YELLOW}[4/5] Running OpenCode: 'read config.txt and summarize it'...${NC}"

cd "$WORK_DIR"
OUTPUT=$(timeout 120 opencode -p "read config.txt and summarize it" -q -f json 2>&1) || true
echo -e "  Output length: $(echo "$OUTPUT" | wc -c) bytes"

# --- Step 5: Verify proxy redacted PII ---
echo ""
echo -e "${YELLOW}[5/5] Verifying proxy intercepted PII...${NC}"
echo ""

# Check vault has tokens
HEALTH_AFTER=$(curl -sf "http://127.0.0.1:${GATEWAY_PORT}/health")
VAULT_AFTER=$(echo "$HEALTH_AFTER" | python3 -c "import sys, json; print(json.load(sys.stdin).get('vaultSize', 0))" 2>/dev/null || echo "0")
echo -e "  Vault size after: ${VAULT_AFTER}"

if [ "$VAULT_AFTER" -gt 0 ]; then
  pass "Vault contains ${VAULT_AFTER} token(s) — PII was intercepted by proxy"
else
  fail "Vault is empty (expected > 0 tokens)"
fi

# Check gateway logs for redaction
GATEWAY_LOG=$(cat /tmp/hush-e2e-proxy.log 2>/dev/null || echo "")
if echo "$GATEWAY_LOG" | grep -qi "redact"; then
  pass "Gateway logs show redaction activity"
else
  fail "Gateway logs don't show redaction (may not be an error if log format changed)"
fi

# --- Summary ---
echo ""
echo -e "${CYAN}================================================${NC}"
TOTAL=$((PASS_COUNT + FAIL_COUNT))
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}  ALL ${TOTAL} CHECKS PASSED${NC}"
  echo ""
  echo -e "  ${GREEN}Plugin allowed config.txt (not a sensitive filename).${NC}"
  echo -e "  ${GREEN}Proxy caught PII in the API request and redacted it.${NC}"
  echo -e "  ${GREEN}Defense-in-depth: plugin + proxy working together.${NC}"
else
  echo -e "${RED}  ${FAIL_COUNT}/${TOTAL} CHECKS FAILED${NC}"
fi
echo -e "${CYAN}================================================${NC}"

exit "$FAIL_COUNT"
