#!/usr/bin/env bash
# run-e2e.sh — Build the stack, initialize it, and run E2E tests.
#
# Required env (or defaults apply):
#   OPENCODE_API_KEY    — from .env, passed via docker compose
#   JWT_SECRET          — from .env
#   E2E_COORDINATOR     — coordinator name (default: Coordinator)
#   E2E_PWA_PASSWORD    — pwa password (default: e2etest123)
#
# Usage:
#   cd /path/to/yeap
#   ./scripts/run-e2e.sh

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Load .env ──────────────────────────────────────────────────────────────────
if [ -f .env ]; then
  # Export vars that aren't already set
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:3000}"
MATTERMOST_URL="${MATTERMOST_URL:-http://localhost:8065}"
REMINDER_URL="${REMINDER_URL:-http://localhost:3001}"
E2E_COORDINATOR="${E2E_COORDINATOR:-Coordinator}"
E2E_PWA_PASSWORD="${E2E_PWA_PASSWORD:-e2etest123}"
MM_ADMIN_USER="${MM_ADMIN_USER:-yeap-admin}"
MM_ADMIN_EMAIL="${MM_ADMIN_EMAIL:-admin@yeap.local}"
MM_TEAM_NAME="yeap"

# Locally, MM SiteURL has no subpath, so the internal URL has no /chat prefix.
# (On production the docker-compose default of http://mattermost:8065/chat is correct.)
export MATTERMOST_INTERNAL_URL="http://mattermost:8065"

# OpenCode Go API config — DeepSeek V4 Flash via OpenCode Go
OPENCODE_BASE_URL="https://opencode.ai/zen/go/v1"
BOT_MODEL="opencode/deepseek-v4-flash"

COMPOSE="docker compose -f infra/docker-compose.yml --env-file .env"

# ── Build images ───────────────────────────────────────────────────────────────
echo ""
echo "==> Building Docker images..."
$COMPOSE build orchestrator reminder pwa bot

# ── Always start from a clean state (wipe volumes) ────────────────────────────
echo ""
echo "==> Tearing down any existing stack (clean slate)..."
# Remove bot containers that hold the yeap-shared volume
docker ps -a --filter name=yeap-bot --format '{{.Names}}' | xargs -r docker rm -f > /dev/null 2>&1 || true
$COMPOSE down -v --remove-orphans > /dev/null 2>&1 || true
# Also wipe bot skillet volumes (created dynamically by docker.ts, not in compose)
docker volume ls --format '{{.Name}}' | grep '^yeap-skillet-' | xargs -r docker volume rm > /dev/null 2>&1 || true

echo ""
echo "==> Starting core services (postgres, mattermost, orchestrator, reminder)..."
$COMPOSE up -d postgres mattermost orchestrator reminder

# ── Wait for orchestrator to be healthy ───────────────────────────────────────
echo ""
echo "==> Waiting for orchestrator to be healthy..."
MAX_WAIT=120
WAIT=0
until curl -sf "${ORCHESTRATOR_URL}/setup/status" > /dev/null 2>&1; do
  if [ $WAIT -ge $MAX_WAIT ]; then
    echo "ERROR: orchestrator did not become healthy after ${MAX_WAIT}s"
    docker compose -f infra/docker-compose.yml logs orchestrator | tail -30
    exit 1
  fi
  echo "  waiting... (${WAIT}s)"
  sleep 5
  WAIT=$((WAIT + 5))
done
echo "  orchestrator is up."

# ── Initialize the stack ──────────────────────────────────────────────────────
echo ""
echo "==> Initializing stack (coordinator: ${E2E_COORDINATOR})..."
SETUP_BODY=$(python3 -c "
import json, sys
print(json.dumps({
  'coordinator_name': '${E2E_COORDINATOR}',
  'pwa_password': '${E2E_PWA_PASSWORD}',
  'mm_admin_email': '${MM_ADMIN_EMAIL}',
  'mm_admin_username': '${MM_ADMIN_USER}',
  'mm_admin_password': '${E2E_PWA_PASSWORD}',
  'provider': 'opencode',
  'model': '${BOT_MODEL}',
  'api_key': '${OPENCODE_API_KEY:-}',
  'base_url': '${OPENCODE_BASE_URL}',
}))
")
MAX_SETUP_WAIT=60
SETUP_WAIT=0
SETUP_RESP=""
until SETUP_RESP=$(curl -sf -X POST "${ORCHESTRATOR_URL}/setup/init" \
  -H 'Content-Type: application/json' \
  -d "$SETUP_BODY" 2>/dev/null); do
  if [ $SETUP_WAIT -ge $MAX_SETUP_WAIT ]; then
    echo "ERROR: /setup/init failed after ${MAX_SETUP_WAIT}s"
    exit 1
  fi
  echo "  setup not ready yet, retrying in 5s... (${SETUP_WAIT}s)"
  sleep 5
  SETUP_WAIT=$((SETUP_WAIT + 5))
done
echo "  setup response: $SETUP_RESP"

# ── Wait for coordinator to come online ───────────────────────────────────────
echo ""
echo "==> Waiting for coordinator to come online..."
MAX_COORD_WAIT=120
COORD_WAIT=0
until [ "$(curl -sf "${ORCHESTRATOR_URL}/registry/bots" | python3 -c "import sys,json; bots=json.load(sys.stdin); coord=next((b for b in bots if b.get('is_coordinator')), None); print(coord.get('status','') if coord else '')" 2>/dev/null)" = "online" ]; do
  if [ $COORD_WAIT -ge $MAX_COORD_WAIT ]; then
    echo "WARNING: Coordinator did not come online after ${MAX_COORD_WAIT}s — tests may fail"
    break
  fi
  echo "  waiting for coordinator... (${COORD_WAIT}s)"
  sleep 5
  COORD_WAIT=$((COORD_WAIT + 5))
done
[ $COORD_WAIT -lt $MAX_COORD_WAIT ] && echo "  coordinator is online."

# ── Obtain JWT token for orchestrator ─────────────────────────────────────────
echo ""
echo "==> Getting orchestrator JWT token..."
JWT_RESP=$(curl -sf -X POST "${ORCHESTRATOR_URL}/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"${E2E_PWA_PASSWORD}\"}")
ORCH_TOKEN=$(python3 -c "import sys,json; print(json.loads('${JWT_RESP}').get('token',''))" 2>/dev/null || echo "")
if [ -z "$ORCH_TOKEN" ]; then
  echo "ERROR: Could not get orchestrator token. Response: $JWT_RESP"
  exit 1
fi
echo "  got orchestrator token."

# ── Obtain Mattermost admin token ─────────────────────────────────────────────
echo ""
echo "==> Logging in to Mattermost as admin..."
MM_LOGIN_RESP=$(curl -si -X POST "${MATTERMOST_URL}/api/v4/users/login" \
  -H 'Content-Type: application/json' \
  -d "{\"login_id\":\"${MM_ADMIN_EMAIL}\",\"password\":\"${E2E_PWA_PASSWORD}\"}")
MM_ADMIN_TOKEN=$(echo "$MM_LOGIN_RESP" | grep -i '^token:' | awk '{print $2}' | tr -d '[:space:]')
if [ -z "$MM_ADMIN_TOKEN" ]; then
  echo "ERROR: Could not get Mattermost admin token."
  echo "$MM_LOGIN_RESP" | tail -5
  exit 1
fi
echo "  got Mattermost admin token."

# ── Run E2E tests ─────────────────────────────────────────────────────────────
echo ""
echo "==> Running E2E tests..."
echo ""

ORCHESTRATOR_URL="$ORCHESTRATOR_URL" \
MATTERMOST_URL="$MATTERMOST_URL" \
REMINDER_URL="$REMINDER_URL" \
MM_ADMIN_TOKEN="$MM_ADMIN_TOKEN" \
MM_TEAM_NAME="$MM_TEAM_NAME" \
ORCH_TOKEN="$ORCH_TOKEN" \
E2E_BOT_MODEL="$BOT_MODEL" \
  pnpm --filter @yeap/e2e test

echo ""
echo "==> E2E tests complete."
