# Agent Instructions

## Redeploying to Production

**Server:** `root@$DEPLOY_HOST`, repo at `/root/yeap` — set `DEPLOY_HOST` in your shell or `.env`.

### Bot image (`yeap-bot:latest`)

Source lives in `packages/agent/`. Compiled output inside containers is at `/app/packages/agent/dist/` (NOT `/app/dist/`).

**`docker restart` does NOT pick up a new image.** Containers must be recreated via the orchestrator's reset endpoint.

Full redeploy sequence:

```bash
ssh root@$DEPLOY_HOST '
  cd /root/yeap &&
  git pull &&
  docker build -f packages/agent/Dockerfile -t yeap-bot:latest . &&
  for bot in Pferd Hammer Besen Pinsel Wobby; do
    curl -s -X POST http://localhost:3000/spawn/reset/$bot
  done
'
```

To verify a fix is live in running containers:

```bash
ssh root@$DEPLOY_HOST 'docker exec yeap-bot-pferd grep -c "SEARCH_TERM" /app/packages/agent/dist/mattermost.js'
```

### Orchestrator image

```bash
ssh root@$DEPLOY_HOST '
  cd /root/yeap &&
  git pull &&
  docker compose -f infra/docker-compose.yml --env-file .env build orchestrator &&
  docker compose -f infra/docker-compose.yml --env-file .env up -d --no-deps --force-recreate orchestrator
'
```

## Mattermost URL configuration

| Environment | Correct internal URL | Notes |
|-------------|---------------------|-------|
| Local dev   | `http://mattermost:8065` | Set `MATTERMOST_INTERNAL_URL=http://mattermost:8065` in `.env`; MM SiteURL has no `/chat` prefix |
| Production  | `http://mattermost:8065/chat` | Default in docker-compose; MM SiteURL is configured with `/chat` prefix via Caddy |

Internal requests from containers must hit MM directly (not through Caddy). If the URL has the wrong prefix, the API returns HTML instead of JSON.

## Running E2E Tests (local)

```bash
bash scripts/run-e2e.sh
```

**Before running (or when tests behave strangely), do a full clean slate:**

```bash
# Remove ALL bot containers (they hold the shared volume and block compose down)
docker ps -a --filter name=yeap-bot --format '{{.Names}}' | xargs -r docker rm -f

# Tear down the compose stack including ALL volumes
docker compose -f infra/docker-compose.yml --env-file .env down -v --remove-orphans

# Also wipe bot skillet volumes (created dynamically, not tracked by compose)
docker volume ls --format '{{.Name}}' | grep '^yeap-skillet-' | xargs -r docker volume rm
```

Failing to do this (especially leaving old bot containers running) causes compose to hang, volumes to stay locked, and tests to see stale state.

To run a single test file:

```bash
MM_LOGIN_RESP=$(curl -si -X POST "http://localhost:8065/api/v4/users/login" \
  -H "Content-Type: application/json" \
  -d '{"login_id":"admin@yeap.local","password":"e2etest123"}') \
&& MM_ADMIN_TOKEN=$(echo "$MM_LOGIN_RESP" | grep -i '^token:' | awk '{print $2}' | tr -d '[:space:]') \
&& ORCH_TOKEN=$(curl -sf -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"e2etest123"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))") \
&& ORCHESTRATOR_URL=http://localhost:3000 \
   MATTERMOST_URL=http://localhost:8065 \
   MM_ADMIN_TOKEN=$MM_ADMIN_TOKEN \
   MM_TEAM_NAME=yeap \
   ORCH_TOKEN=$ORCH_TOKEN \
   E2E_BOT_MODEL=opencode/deepseek-v4-flash \
   pnpm --filter @yeap/e2e exec vitest run --reporter=verbose tests/TESTFILE.test.ts
```
