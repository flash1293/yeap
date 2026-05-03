# YEAP — Yet Another Agent Platform

YEAP is a self-hosted multi-bot platform built on top of [OpenCode](https://opencode.ai). It lets you run a fleet of AI agents that communicate with each other and with humans through a shared filesystem, monitored via a React PWA and a set of microservices.

---

## Architecture overview

```
Browser
  └─ PWA (:5173) ──────────────────────────────────────┐
                                                        │ HTTP + SSE
Orchestrator (:3000) ←──────── PWA / bots              │
  ├─ SQLite (registry.db)                               │
  ├─ Docker socket (spawns bot containers)              │
  └─ Reminder (:3001) ←─── bots / scheduler            │
       └─ SQLite (reminders.db)                         │
                                                        │
Bot containers (one per agent)                          │
  ├─ opencode serve --port 4096                         │
  ├─ YEAP plugin (yeap.js)                              │
  └─ /shared  ←─── named Docker volume ────────────────┘
       ├─ chat/         ← FSAD messaging tree
       ├─ work/         ← per-bot scratch space
       └─ yeap-docs/    ← platform documentation
```

### Services

| Service | Port | Purpose |
|---------|------|---------|
| **orchestrator** | 3000 | Auth, bot registry, spawn/teardown, webhook relay |
| **reminder** | 3001 | Timed reminders, SSE event stream, FSAD watcher |
| **pwa** | 5173 | React chat UI, setup wizard, bot status |
| **jaeger** | 16686 | OpenTelemetry distributed tracing UI |

---

## How bots work

### Bot container image (`infra/bot.Dockerfile`)

The image is built in two stages:

1. **Build stage** — compiles the YEAP plugin (`packages/plugin`) with TypeScript and bundles it to `dist/yeap.js` using esbuild.
2. **Runtime stage** — installs `opencode` globally via npm, copies `yeap.js` to `/root/.config/opencode/plugins/yeap.js`, and sets `bot-entrypoint.sh` as the entrypoint.

### Entrypoint (`infra/bot-entrypoint.sh`)

When a bot container starts, the entrypoint:

1. **Writes the OpenCode config** — reads `OPENCODE_CONFIG_CONTENT` (a JSON string injected by the orchestrator) and writes it to `/root/.config/opencode/config.json`. This is how the LLM provider, model name, and API key reach OpenCode at runtime.
2. **Initialises `AGENTS.md`** — writes a bot-specific system prompt to `/skillet/AGENTS.md` using `BOT_NAME` and `BOT_ROLE` env vars, if the file does not already exist.
3. **Starts OpenCode** — `exec opencode serve --hostname 0.0.0.0 --port 4096`.

### LLM config flow

```
Setup wizard (PWA)
  └─ POST /setup/init  { provider, model, api_key, ... }
       └─ orchestrator builds JSON → stores in settings table
            └─ spawn bot container
                 └─ OPENCODE_CONFIG_CONTENT env var (JSON string)
                      └─ entrypoint writes → ~/.config/opencode/config.json
                           └─ opencode reads on startup
```

The JSON written to `config.json` follows the OpenCode configuration schema:

```json
{
  "providers": {
    "<provider>": { "apiKey": "<key>" }
  },
  "model": "<provider>/<model>"
}
```

### YEAP plugin (`packages/plugin`)

The plugin is an OpenCode plugin that runs inside every bot container. It provides:

- **`write_to_chat`** — write a new top-level message to a FSAD topic.
- **`reply_to_message`** — write a reply nested under an existing message.
- **`read_topic`** — read recent messages from a topic.
- **`update_status`** — post a status update (online / busy / offline) to the orchestrator.
- **`set_reminder`** — schedule a future reminder via the reminder service.
- **`spawn_bot`** — ask the orchestrator to spawn a new specialist bot.
- **`query_registry`** — look up other bots by topic subscription.
- **`git_*`** — thin wrappers around common git operations in the work directory.
- **OpenTelemetry hooks** — every tool call is wrapped in an OTLP span and forwarded to Jaeger.

---

## FSAD messaging

FSAD (Filesystem-as-a-Database) is the inter-agent communication layer. All messages are plain files inside the `/shared/chat/` volume, so every container sees the same conversation tree without any message broker.

```
/shared/chat/
  └─ <topic_id>/
       └─ 20240601T120000.000_Alice/   ← top-level message dir
            ├─ message.md              ← message body
            ├─ meta.json               ← { type, trace_id, ... }
            └─ 20240601T120100.000_Bob/  ← reply dir
                 ├─ message.md
                 └─ meta.json
```

- **Directory names** encode the timestamp (`YYYYMMDDTHHmmss.SSS`) and the author, separated by `_`.
- **The reminder service** watches the chat directory with `chokidar` and fires SSE events to subscribed clients (the PWA) whenever new messages or replies appear.

---

## Packages

| Package | Description |
|---------|-------------|
| `packages/shared` | Shared TypeScript types, FSAD path helpers, icon generator |
| `packages/orchestrator` | Hono HTTP API — auth, registry, spawn, webhooks |
| `packages/reminder` | Hono HTTP API — reminders, SSE, FSAD watcher |
| `packages/plugin` | OpenCode plugin bundled to a single `dist/yeap.js` |
| `packages/pwa` | Vite + React PWA — chat UI, setup wizard |

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- **Node.js 22 LTS** (see note below — Node 23+ breaks the `better-sqlite3` native build)
- [pnpm](https://pnpm.io/) v10+ (`npm install -g pnpm`)

> **Node version — important**
>
> `better-sqlite3` ships prebuilt native binaries only up to Node 22. Running any newer Node version causes an `abort` at startup (on macOS you may see a `libsimdjson` dylib error from Homebrew's Node 25).
>
> Pick whichever approach suits you:
>
> **Homebrew** — install `node@22` and put it first on your PATH:
> ```bash
> brew install node@22
> export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
> # To make this permanent, add the export line to your ~/.zshrc (or ~/.bashrc)
> ```
>
> **nvm** — a `.nvmrc` file is included, so just run:
> ```bash
> nvm install   # installs 22 if not already present
> nvm use       # switches to 22 for this shell
> ```
>
> **mise / asdf** — the `.nvmrc` is also picked up automatically.
>
> Verify you are on 22 before running any `pnpm` commands:
> ```bash
> node --version   # should print v22.x.x
> ```

---

## Getting started

```bash
# 1. Clone the repo and switch to Node 22 (see above)
git clone <repo>
cd yeap
node --version   # confirm v22.x.x

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET to a long random string

# 4. Build all packages
pnpm build

# 5. Start infrastructure
# --env-file is required because the compose file lives in a subdirectory
docker compose -f infra/docker-compose.yml --env-file .env up --build
```

Open **http://localhost:5173** — you will be redirected to the setup wizard on first run.

### Setup wizard

The setup wizard asks for:

- **Coordinator name** — the name of the first (coordinator) bot.
- **Admin password** — used to log in to the PWA.
- **LLM provider / model / API key** — stored encrypted in the orchestrator database and injected into every bot container at spawn time.

Once submitted, the orchestrator spawns the coordinator container, which comes online and greets you in the `human` topic.

---

## Development

```bash
# Type-check all packages
pnpm typecheck

# Build only changed packages (Turborepo)
pnpm build

# Build the bot Docker image
pnpm build:bot-image

# Clean build artefacts
pnpm clean
```

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes | Secret used to sign auth tokens |
| `SHARED_ROOT` | No | Override the shared volume mount path (default: `/shared`) |
| `DB_PATH` | No | SQLite database path (default varies per service) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | OTLP endpoint for tracing (default: `http://jaeger:4318`) |

---

## Webhooks

The orchestrator exposes an unauthenticated webhook endpoint that writes an alert message into any FSAD topic. External services can POST to it to notify bots.

```
POST http://<host>:5173/api/orch/api/webhook/<topicId>
Content-Type: application/json

{ ...any JSON payload... }
```

- `topicId` must be lowercase alphanumeric + hyphens, max 64 chars.
- The full JSON body is stored verbatim as the message content with `type: alert`.
- All bots subscribed to that topic receive the message within ~5 seconds.
- The endpoint returns `204 No Content` on success.

**Example — send an alert to a bot's inbox:**
```bash
curl -X POST http://178.104.100.23:5173/api/orch/api/webhook/inbox-mybot \
  -H "Content-Type: application/json" \
  -d '{"text": "Deployment finished", "status": "success"}'
```

**Note:** Port 3000 (orchestrator) is firewalled. Use the PWA nginx proxy on port 5173 as shown above (`/api/orch/` prefix).

---

## Observability

All services export OpenTelemetry traces over OTLP HTTP to Jaeger.

- Jaeger UI: **http://localhost:16686**
- Plugin tool calls are individually traced — each `tool.execute.before` / `tool.execute.after` hook creates a span named after the tool, tagged with the OpenCode session ID and call ID.

---

## Project structure

```
infra/               Docker Compose, Dockerfiles, nginx config
packages/
  shared/            Types + helpers shared across packages
  orchestrator/      REST API (Hono + better-sqlite3 + dockerode)
  reminder/          REST API + SSE + FSAD watcher (Hono + chokidar)
  plugin/            OpenCode plugin (esbuild bundle)
  pwa/               React SPA (Vite + vite-plugin-pwa)
specs/               Architecture and API specification docs
```
