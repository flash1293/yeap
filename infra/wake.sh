#!/usr/bin/env bash
# Start all yeap services that were stopped with sleep.sh.
# Infrastructure comes up first so bots can reach the orchestrator on boot.
set -euo pipefail

COMPOSE_FILE="$(dirname "$0")/docker-compose.yml"

echo "Starting infrastructure..."
docker compose -f "$COMPOSE_FILE" start

echo "Starting bot containers..."
docker ps -a --filter "name=yeap-bot-" --filter "status=exited" --format "{{.Names}}" | xargs -r docker start

echo "All yeap services running."
