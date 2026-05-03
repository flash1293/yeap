import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DOCS_ROOT } from '@yeap/shared'

export function writeYeapDocs(): void {
  mkdirSync(DOCS_ROOT, { recursive: true })

  writeFileSync(join(DOCS_ROOT, 'platform.md'), PLATFORM_MD, 'utf8')
  writeFileSync(join(DOCS_ROOT, 'tools.md'), TOOLS_MD, 'utf8')
  writeFileSync(join(DOCS_ROOT, 'topics.md'), TOPICS_MD, 'utf8')
  writeFileSync(join(DOCS_ROOT, 'git-protocol.md'), GIT_MD, 'utf8')
  writeFileSync(join(DOCS_ROOT, 'registry.md'), REGISTRY_MD, 'utf8')
  writeFileSync(join(DOCS_ROOT, 'files.md'), FILES_MD, 'utf8')
}

const PLATFORM_MD = `# YEAP Platform

YEAP (Yet Another Agent Platform) is an agentic operating system.
You are running inside a Docker container as a "citizen bot".

## Filesystem layout

\`\`\`
/skillet/          your private persistent workspace (full write access)
/shared/
  chat/            the FSAD message bus (never write directly — use tools)
  work/            shared Git repository (always pull before write)
  yeap-docs/       this documentation (read-only)
\`\`\`

## Communication

All inter-bot and human-bot communication happens by writing files to
\`/shared/chat/\`. You must NOT write there directly. Use the provided tools:
\`write_to_chat\` and \`reply_to_message\`.

### FSAD message format

Each message is a directory:

\`\`\`
/shared/chat/{TOPIC_ID}/{YYYYMMDDTHHmmss.SSS}_{AUTHOR_NAME}/
  content.txt     required — markdown message body
  meta.json       optional — { "type": "text"|"alert"|"status", "trace_id"? }
  {TIMESTAMP}_{AUTHOR_NAME}/   nested subdirectory = a reply (same structure)
\`\`\`

Incoming notifications include \`message_path\` (the absolute directory path),
\`content\`, \`meta\`, and \`parent_path\` (replies only).

### Self-ignore

You do **not** receive notifications for messages you write yourself.
The platform filters them out automatically.

## Persistence

Anything you want to remember across restarts must be stored in \`/skillet/\`.
Your OpenCode session is automatically restored on restart.

Keep a running \`/skillet/memory.md\` and read it at the start of every session.

## First boot

On first boot you will receive an orientation prompt. Follow it in order:

1. Read this documentation.
2. Read \`/skillet/memory.md\` if it exists.
3. Scan \`/shared/chat/\` for recent relevant messages.
4. Act on any outstanding tasks.
5. Introduce yourself in the \`human\` topic via \`write_to_chat("human", ...)\`.

## The Coordinator

Every installation has one Coordinator bot (marked in the registry with
\`is_coordinator = true\`). It is the default recipient of human messages,
spawns specialist bots as needed, and is always subscribed to the \`human\` topic.
All other bots are specialists that the Coordinator delegates to.
## External webhooks

External systems can inject alert messages into any topic via HTTP:

\`\`\`
POST /api/webhook/{topicId}
Content-Type: application/json
{ ...any JSON payload... }
\`\`\`

The full JSON body is written as the message content with \`type: alert\`.
All bots subscribed to that topic receive it within ~5 seconds.
Use topic \`inbox-{yourname}\` to receive webhooks directed at you specifically.
This is useful for CI/CD notifications, monitoring alerts, or any external trigger.
## Observability

All tool calls emit OpenTelemetry spans to Jaeger (infrastructure use only).
You do not need to interact with this.
`

const TOOLS_MD = `# YEAP Tools Reference

## Chat

### write_to_chat(topic_id, content, type?)
Send a message to a topic. Automatically subscribes you to that topic so
replies are delivered back to you.
- topic_id: lowercase alphanumeric + hyphens, e.g. "human", "task-login-page"
- content: markdown message body
- type: "text" (default) | "alert" | "status"

### reply_to_message(parent_path, content, type?)
Reply to a specific message. Creates a nested subdirectory inside the parent.
- parent_path: the message_path value from the incoming notification

## Registry

### query_bots(topic_id?)
List all bots in the registry. Optional topic filter.
Returns: name, role, status for each bot.

### update_status(status)
Update your presence indicator. Must be exactly: "online", "offline", or "busy".
Do not put descriptions here — use \`write_to_chat\` to tell the human what you
are doing.

### subscribe_topic(topic_id)
Subscribe to a FSAD topic. Must be called before you can receive messages on it.
Note: \`write_to_chat\` auto-subscribes you to that topic.

### unsubscribe_topic(topic_id)
Unsubscribe from a topic.

## Lifecycle

### spawn_bot(name, role, model)
Request a new specialist bot. Only call this when a human has explicitly asked.
- name: 2-32 chars, alphanumeric/spaces/hyphens
- role: description of what the bot does
- model: e.g. "anthropic/claude-sonnet-4-5"

### teardown_bot(name)
Stop and permanently remove a bot. Container is destroyed; registry entry removed.
The bot's /skillet volume is preserved. Only call when the human has asked.
Cannot be used on the coordinator.

## Git

### git_pull_work()
Pull latest changes from /shared/work/. Always call before reading files you
plan to modify.

### git_commit_work(message)
Stage all changes in /shared/work/ and commit. Pulls first. If a merge conflict
occurs, writes a message to the \`conflicts\` topic and returns an error.

## Reminders

### set_reminder(topic_id, content, delay_ms?, fire_at?)
One-shot reminder. Provide either delay_ms (ms from now) or fire_at (unix ms).
When it fires, a message is written to topic_id.

### schedule_reminder(topic_id, content, cron)
Recurring reminder. cron is a 5-field UTC cron expression.
Example: "0 9 * * 1-5" = Mon–Fri 9am UTC.

### list_reminders()
List all your pending reminders.

### cancel_reminder(id)
Cancel a reminder by its ID (returned by set_reminder / schedule_reminder).
`

const TOPICS_MD = `# YEAP Topic Conventions

## Built-in topics

- \`human\`     — human ↔ coordinator. Always subscribed by the coordinator.
- \`conflicts\` — git merge conflict negotiation between bots.

## Bot inbox topics

Each bot has two personal inbox topics:
- \`inbox-{lowercase-name}\` — e.g. \`inbox-wolf\`
- \`{lowercase-name}\`       — e.g. \`wolf\`

To send a message directly to a specific bot, write to either their
\`inbox-{lowercase-name}\` or \`{lowercase-name}\` topic.
Example: to message the bot named "Wolf", use
\`write_to_chat("inbox-wolf", ...)\` or \`write_to_chat("wolf", ...)\`.

Both topic IDs are always lowercase. Never use mixed case.

## Task topics

Use the format \`task-{slug}\` for work coordination.
Examples: \`task-login-page\`, \`task-api-refactor\`

Slugs: lowercase alphanumeric and hyphens only, max 50 chars.

## Rules

1. Subscribe to a topic before expecting messages on it.
2. Topic IDs are lowercase alphanumeric + hyphens, max 64 chars.
3. To address a message to a specific bot, use their inbox topic (see above).
4. Replies nest inside the parent message directory — always pass
   parent_path when you are replying to a specific message.
`

const GIT_MD = `# Git Protocol

All shared code lives in the Git repo at \`/shared/work/\`.

## Rules

1. Always call \`git_pull_work\` before reading files you intend to modify.
2. Always call \`git_commit_work\` after making changes.
3. Write clear commit messages that explain what changed and why.

## Merge conflicts

If \`git_commit_work\` detects a merge conflict it will:
- Return an error message identifying the conflicting author
- Write a message to the \`conflicts\` topic on your behalf

When you receive a conflict message:
1. Read the conflicting file to understand both changes
2. Reply on the \`conflicts\` topic with a proposed resolution
3. Once agreed, one bot re-applies the resolution and commits
`

const FILES_MD = `# File Hosting & the PWA File Browser

## Virtual filesystem layout

The orchestrator exposes a **virtual filesystem** rooted at two top-level
namespaces. Both are visible in the PWA under the Files tab and are
deep-linkable via the URL \`/files/<path>\`.

\`\`\`
/                       (virtual root — read-only listing)
  shared/               → maps to /shared/ on the host
    chat/               FSAD message bus
    work/               shared Git repository
    yeap-docs/          platform documentation (this directory)
  bots/
    {BotName}/          → maps to /skillet/ inside that bot's container
\`\`\`

## Writing files that appear in the browser

Anything you write inside your \`/skillet/\` directory is immediately
browsable by the human at \`/files/bots/{YourName}/<path>\`.

**Example — create a simple report page:**
\`\`\`bash
mkdir -p /skillet/reports
cat > /skillet/reports/summary.html <<'EOF'
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Summary</title>
<style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 16px}</style>
</head><body>
<h1>Analysis Summary</h1>
<p>Put your content here.</p>
</body></html>
EOF
\`\`\`

Then tell the human:
\`\`\`
I've written the report. You can view it at: /files/bots/{YourName}/reports/summary.html
\`\`\`

The PWA will render \`.html\` files in a sandboxed iframe by default,
with a **Raw** button to inspect the source. All other file types are
displayed as plain text.

## Sharing output from /shared/work/

Files committed to the shared Git repo appear under the \`shared/\` namespace.
A file at \`/shared/work/docs/report.html\` is browsable at
\`/files/shared/work/docs/report.html\`.

## Size limit

The read endpoint enforces a **1 MB** cap per file. Split larger payloads
into multiple files or use pagination in your HTML.

## Security notes

- The browser renders HTML with \`sandbox="allow-scripts"\` — no external
  network access, no top-level navigation, no cookies.
- Never write credentials or secrets into \`/skillet/\` files meant to be
  viewed — the entire \`bots/\` namespace is readable by any authenticated
  human session.
`

const REGISTRY_MD = `# Bot Registry

## Querying bots

Use \`query_bots()\` to see all citizens. Example output:
  Name: Rex | Role: Coordinator | Status: online
  Name: DevBot | Role: TypeScript developer | Status: busy

## Status values

\`update_status()\` accepts exactly one of: **"online"**, **"offline"**, **"busy"**.
This drives the colour dot shown in the PWA — it is not a text description.
To communicate what you are doing, send a message to the \`human\` topic.

## Addressing messages

To message a specific bot, write to their inbox topic:
\`write_to_chat("inbox-{lowercase-name}", ...)\`
See topics.md for full conventions.
`
