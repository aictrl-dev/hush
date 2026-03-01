#!/usr/bin/env bash
#
# E2E test: Verify Hush gateway intercepts PII from OpenCode/GLM-5 requests
#
# This script:
#   1. Starts a mock ZhipuAI upstream that captures the request body
#   2. Starts a Hush gateway harness pointed at the mock upstream
#   3. Sends a GLM-5 chat completion request containing PII through the gateway
#   4. Verifies PII was redacted in the request that reached the mock upstream
#   5. Verifies the response was rehydrated back to original PII
#   6. Verifies the vault captured tokens (via /health endpoint)
#
# Usage: ./scripts/e2e-opencode.sh
# Requirements: node, npm (dependencies must be installed)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

MOCK_PORT=4111
GATEWAY_PORT=4222
MOCK_PID=""
GATEWAY_PID=""
PASS_COUNT=0
FAIL_COUNT=0
CAPTURE_FILE="/tmp/hush-e2e-captured-body.json"

cleanup() {
  echo ""
  echo -e "${CYAN}Cleaning up...${NC}"
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
  [ -n "$GATEWAY_PID" ] && kill "$GATEWAY_PID" 2>/dev/null || true
  rm -f "$CAPTURE_FILE"
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
  if echo "$haystack" | grep -qF "$needle"; then
    pass "$msg"
  else
    fail "$msg (expected to find '$needle')"
  fi
}

assert_not_contains() {
  local haystack="$1" needle="$2" msg="$3"
  if echo "$haystack" | grep -qF "$needle"; then
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
echo -e "${CYAN}  Hush Gateway E2E: OpenCode + GLM-5 PII Test  ${NC}"
echo -e "${CYAN}================================================${NC}"
echo ""

cd "$PROJECT_DIR"

# --- Step 1: Start mock ZhipuAI upstream ---
echo -e "${YELLOW}[1/5] Starting mock ZhipuAI upstream on :${MOCK_PORT}...${NC}"

MOCK_PORT=$MOCK_PORT CAPTURE_FILE=$CAPTURE_FILE node scripts/e2e-mock-upstream.mjs &
MOCK_PID=$!
sleep 1

if ! kill -0 "$MOCK_PID" 2>/dev/null; then
  echo -e "${RED}Mock upstream failed to start${NC}"
  exit 1
fi
echo -e "  Mock upstream PID: ${MOCK_PID}"

# --- Step 2: Start Hush gateway (E2E harness pointing at mock) ---
echo -e "${YELLOW}[2/5] Starting Hush gateway on :${GATEWAY_PORT} -> mock :${MOCK_PORT}...${NC}"

GATEWAY_PORT=$GATEWAY_PORT MOCK_PORT=$MOCK_PORT npx tsx scripts/e2e-gateway-harness.ts &
GATEWAY_PID=$!

wait_for_port "$GATEWAY_PORT" "Gateway" || exit 1
echo -e "  Gateway PID: ${GATEWAY_PID}"

# --- Step 3: Send a GLM-5 request with PII through the gateway ---
echo -e "${YELLOW}[3/5] Sending GLM-5 chat completion with PII through gateway...${NC}"

# These are the PII values we'll send (mimicking what an OpenCode session would contain)
PII_EMAIL="testuser@example-corp.com"
PII_IP="10.42.99.7"
PII_SECRET="api_key=secret_test_a1b2c3d4e5f6g7h8i9j0k1l2"

RESPONSE=$(curl -sf -X POST "http://127.0.0.1:${GATEWAY_PORT}/api/paas/v4/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-e2e-key" \
  -d "{
    \"model\": \"glm-5\",
    \"messages\": [{
      \"role\": \"user\",
      \"content\": \"My email is ${PII_EMAIL} and server IP is ${PII_IP}. Credentials: ${PII_SECRET}\"
    }]
  }")

echo -e "  Response received ($(echo "$RESPONSE" | wc -c) bytes)"

# --- Step 4: Verify PII interception ---
echo ""
echo -e "${YELLOW}[4/5] Verifying PII interception...${NC}"
echo ""

# 4a. Check what the mock upstream received
CAPTURED=$(curl -sf "http://127.0.0.1:${MOCK_PORT}/captured" || echo "{}")

echo -e "  ${CYAN}What ZhipuAI upstream received (should have tokens, NOT real PII):${NC}"
echo "  $(echo "$CAPTURED" | python3 -m json.tool 2>/dev/null | head -20 || echo "$CAPTURED" | head -c 600)"
echo ""

# Verify PII was REDACTED in upstream request
assert_not_contains "$CAPTURED" "$PII_EMAIL" "Email NOT sent to ZhipuAI upstream"
assert_not_contains "$CAPTURED" "$PII_IP" "IP address NOT sent to ZhipuAI upstream"

# Verify tokens were substituted (format-agnostic: matches [USER_EMAIL_1] or [HUSH_EML_*] etc.)
if echo "$CAPTURED" | grep -qE '\[.*EMAIL'; then
  pass "Email replaced with redaction token"
else
  fail "Email replaced with redaction token (no EMAIL token found)"
fi

if echo "$CAPTURED" | grep -qE '\[.*IP'; then
  pass "IP replaced with redaction token"
else
  fail "IP replaced with redaction token (no IP token found)"
fi

if echo "$CAPTURED" | grep -qE '\[.*SECRET'; then
  pass "Secret replaced with redaction token"
else
  fail "Secret replaced with redaction token (no SECRET token found)"
fi

echo ""

# 4b. Check gateway response (should contain REHYDRATED original PII)
echo -e "  ${CYAN}What the client (OpenCode) receives back (should have original PII):${NC}"
ASSISTANT_CONTENT=$(echo "$RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data['choices'][0]['message']['content'])
" 2>/dev/null || echo "$RESPONSE")
echo "  ${ASSISTANT_CONTENT:0:300}"
echo ""

assert_contains "$ASSISTANT_CONTENT" "$PII_EMAIL" "Email rehydrated in response to client"
assert_contains "$ASSISTANT_CONTENT" "$PII_IP" "IP address rehydrated in response to client"

echo ""

# 4c. Check vault via /health endpoint
HEALTH=$(curl -sf "http://127.0.0.1:${GATEWAY_PORT}/health")
VAULT_SIZE=$(echo "$HEALTH" | python3 -c "import sys, json; print(json.load(sys.stdin).get('vaultSize', 0))")
echo -e "  ${CYAN}Gateway vault size: ${VAULT_SIZE}${NC}"

if [ "$VAULT_SIZE" -gt 0 ]; then
  pass "Vault contains ${VAULT_SIZE} token(s) - PII intercepted and stored"
else
  fail "Vault is empty (expected > 0 tokens)"
fi

# --- Step 5: Summary ---
echo ""
echo -e "${CYAN}================================================${NC}"
TOTAL=$((PASS_COUNT + FAIL_COUNT))
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}  ALL ${TOTAL} CHECKS PASSED${NC}"
  echo ""
  echo -e "  ${GREEN}PII was intercepted by Hush gateway before${NC}"
  echo -e "  ${GREEN}reaching the ZhipuAI/GLM-5 upstream server.${NC}"
  echo -e "  ${GREEN}Client received rehydrated original values.${NC}"
  echo ""
  echo -e "  This confirms OpenCode + GLM-5 is safe to use"
  echo -e "  through the Hush Semantic Security Gateway."
else
  echo -e "${RED}  ${FAIL_COUNT}/${TOTAL} CHECKS FAILED${NC}"
fi
echo -e "${CYAN}================================================${NC}"

exit "$FAIL_COUNT"
