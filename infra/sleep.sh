#!/usr/bin/env bash
# Stop all yeap services without destroying containers.
# Bot containers are stopped first so they don't generate errors
# trying to reach a shutting-down orchestrator.
set -euo pipefail

COMPOSE_FILE="$(dirname "$0")/docker-compose.yml"

echo "Stopping bot containers..."
docker ps --filter "name=yeap-bot-" --format "{{.Names}}" | xargs -r docker stop

echo "Stopping infrastructure..."
docker compose -f "$COMPOSE_FILE" stop

echo "All yeap services stopped. Run infra/wake.sh to bring them back."
