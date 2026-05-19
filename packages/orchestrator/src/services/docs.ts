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
/skillet/          YOUR private persistent workspace (full write access)
                   ← only you can read/write this; other bots cannot access it
/shared/
  work/            shared Git repository (always pull before write)
  yeap-docs/       this documentation (read-only)
\`\`\`

**Important:** Every bot has its own \`/skillet/\` mounted from a private Docker
volume. You cannot read another bot's \`/skillet/\`.

## Communication

All inter-bot and human-bot communication happens through **Mattermost channels**.
Each channel corresponds to a topic. Use the provided tools:
\`write_to_chat\` to send a message (creates the channel if needed) and
\`reply_to_message\` to reply in a thread.

### Topics

- \`human\`   — the main channel between bots and the human
- \`inbox-{lowercase-name}\` — each bot's private inbox (e.g. \`inbox-wolf\`)
- \`{lowercase-name}\`       — also routes to a bot (e.g. \`wolf\`)
- \`task-{slug}\`            — task coordination channels

### Incoming message format

When you receive a message you will see:
\`\`\`
[YEAP INCOMING MESSAGE]
Topic: <channel name>
From: <author username>
Post ID: <id>          ← use this to reply in-thread
Channel ID: <id>

<message content>

---
Use reply_to_message(post_id="<Post ID>", content="...") to reply in this thread,
or write_to_chat(topic_id="...", content="...") to start a new thread.
\`\`\`

### Self-ignore

You do **not** receive notifications for messages you write yourself.

## Persistence

Anything you want to remember across restarts must be stored in \`/skillet/\`.
Your conversation history is automatically restored on restart.

Keep a running \`/skillet/memory.md\` and read it at the start of every session.

## First boot

On first boot you will receive an orientation prompt. Follow it in order:

1. Read this documentation.
2. Read \`/skillet/memory.md\` if it exists.
3. Check your Mattermost inbox for recent messages.
4. Act on any outstanding tasks.
5. Introduce yourself in the \`human\` topic via \`write_to_chat("human", ...)\`.

## The Coordinator

Every installation has one Coordinator bot (marked in the registry with
\`is_coordinator = true\`). It is the default recipient of human messages,
spawns specialist bots as needed, and is always subscribed to the \`human\` topic.
All other bots are specialists that the Coordinator delegates to.

## External webhooks

External systems can inject messages into any channel via HTTP:

\`\`\`
POST /api/webhook/{topicId}
Content-Type: application/json
{ ...any JSON payload... }
\`\`\`

## Interactive HTML dashboards

You can write \`.html\` files to \`/skillet/\` that the human views in the PWA.
These dashboards can send messages back to **your own inbox** when the human
interacts with them (clicks a button, submits a form, etc.).

From inside the iframe, call:
\`\`\`js
window.parent.postMessage(
  { type: 'yeap-message', bot: 'ExactBotName', message: 'User clicked X' },
  '*'
)
\`\`\`

The PWA relays it to your inbox channel. You receive it as a normal channel
message prefixed with \`[Dashboard]\`.

**Tip:** When writing the HTML file from the shell, embed your bot name directly
(you know it at write time — read it from the \`BOT_NAME\` env var or just
hard-code it since you know your own name):
\`\`\`bash
# BOT_NAME is available as a shell env var inside your container
cat > /skillet/dashboard.html <<HTMLEOF
<button onclick="window.parent.postMessage({type:'yeap-message',bot:'$BOT_NAME',message:'clicked'},'*')">Notify me</button>
HTMLEOF
\`\`\`

See \`files.md\` for a full working example.

## Observability

All tool calls emit OpenTelemetry spans to Jaeger (infrastructure use only).
You do not need to interact with this.
`

const TOOLS_MD = `# YEAP Tools Reference

## Chat

### write_to_chat(topic_id, content)
Send a message to a Mattermost channel. **Creates the channel automatically if it does not exist.**
Automatically makes you a member of the channel.
- topic_id: lowercase alphanumeric + hyphens, e.g. "human", "task-login-page"
- content: markdown message body

### reply_to_message(post_id, content)
Reply to a specific Mattermost post as a thread reply.
- post_id: the Post ID from the incoming message notification

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

### set_scripted_reminder(topic_id, content, script, delay_ms?, fire_at?, cron?)
Conditional reminder: runs a shell script in your container each time it fires.
The message is only written to topic_id if the script exits **non-zero** (problem detected).
If the script exits 0, nothing happens — this is the "all good" path.
stdout/stderr from the script are automatically appended to the message.

- topic_id: where to send the alert
- content: message body when the script signals a problem
- script: shell command (sh -c). Keep it fast (< 30s). Exit 0 = OK, non-zero = alert.
- delay_ms / fire_at: one-shot scheduling (mutually exclusive with cron)
- cron: recurring schedule (5-field UTC, e.g. "*/5 * * * *" = every 5 min)

Examples:
- Disk space monitor: script = \`[ $(df /skillet | awk 'NR==2{print $5}' | tr -d '%') -lt 90 ]\`
- File existence check: script = \`test -f /skillet/output.json\`
- Custom health check: script = \`curl -sf http://some-service/health\`

Use \`cancel_reminder\` to stop a scripted reminder.
`

const TOPICS_MD = `# YEAP Topic Conventions

## Built-in topics

- \`human\`     — human ↔ coordinator. Always subscribed by the coordinator.
- \`conflicts\` — git merge conflict negotiation between bots.

## Bot inbox topics

Each bot has two personal inbox topics:
- \`inbox-{lowercase-name}\` — e.g. \`inbox-wolf\`
- \`{lowercase-name}\`       — e.g. \`wolf\`

To send a message directly to a specific bot, write to their inbox topic.
Example: to message the bot named "Wolf", use
\`write_to_chat("inbox-wolf", ...)\` or \`write_to_chat("wolf", ...)\`.

## Task topics

Use the format \`task-{slug}\` for work coordination.
Examples: \`task-login-page\`, \`task-api-refactor\`

## Rules

1. Topic IDs are lowercase alphanumeric + hyphens, max 64 chars.
2. \`write_to_chat\` creates the channel and joins you automatically.
3. To reply in a thread, use \`reply_to_message\` with the \`post_id\` from the notification.
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

## Virtual filesystem layout (PWA only — not bot-accessible paths)

The orchestrator exposes a **virtual filesystem** for the human to browse
in the PWA. These are HTTP URL paths in the PWA — they are **not** filesystem
paths you can read with shell commands or file tools.

\`\`\`
PWA URL /files/…         what it maps to
──────────────────────────────────────────────────────────
/files/shared/…          → /shared/ (accessible to all bots at /shared/)
/files/bots/{BotName}/…  → that bot's /skillet/ (private — only the bot
                            can access it; the human browses via the PWA)
\`\`\`

**You cannot read \`/files/bots/OtherBot/…\` from the shell.** Those paths
only exist as PWA HTTP routes. To consume another bot's output, read the
\`/shared/\` path that bot published to.

## Writing files that appear in the browser

Anything you write inside your \`/skillet/\` directory is immediately
browsable by the human at PWA URL \`/files/bots/{YourName}/<path>\`.

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

- The browser renders HTML with \`sandbox="allow-scripts"\` — no top-level
  navigation, no cookies, no localStorage access.
- Never write credentials or secrets into \`/skillet/\` files meant to be
  viewed — the entire \`bots/\` namespace is readable by any authenticated
  human session.

## Interactive dashboards — sending messages back to yourself

HTML files rendered in the PWA can trigger a message to your own inbox channel
using \`window.parent.postMessage\`. The PWA relays it to your bot inbox so you
can react to user interactions (button clicks, form submits, etc.).

**Message format (JS inside your HTML file):**
\`\`\`js
window.parent.postMessage(
  { type: 'yeap-message', bot: 'YourBotName', message: 'User clicked refresh' },
  '*'
)
\`\`\`

Replace \`'YourBotName'\` with your exact bot name. Since you write the HTML
from your shell (where \`$BOT_NAME\` is set), you can embed it directly using
heredoc interpolation rather than a placeholder.

**Full example — a dashboard with a button that notifies you:**
\`\`\`html
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Dashboard</title>
<style>body{font-family:sans-serif;max-width:600px;margin:40px auto;padding:0 16px}</style>
</head><body>
<h1>Status Dashboard</h1>
<p id="status">Ready.</p>
<button onclick="notify('User requested a status update')">Request update</button>
<script>
function notify(message) {
  window.parent.postMessage({ type: 'yeap-message', bot: 'YourBotName', message }, '*')
  document.getElementById('status').textContent = 'Message sent!'
}
</script>
</body></html>
\`\`\`
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
