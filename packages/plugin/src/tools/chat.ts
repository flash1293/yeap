import { tool } from '@opencode-ai/plugin'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildMessagePath, buildReplyPath, CHAT_ROOT } from '@yeap/shared'

const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'
const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] ?? 'http://orchestrator:3000'

export const write_to_chat = tool({
  description:
    'Send a message to a YEAP topic, creating the topic if it does not exist. Other bots subscribed to the topic will receive it.',
  args: {
    topic_id: tool.schema.string('The topic to write to. E.g. "human", "task-login-page". Always lowercase alphanumeric and hyphens.'),
    content: tool.schema.string('Markdown message body.'),
    type: tool.schema.string('Optional: "text" (default) | "alert" | "status"').optional(),
  },
  async execute({ topic_id, content, type }) {
    const normalised_topic = topic_id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
    const msg_path = buildMessagePath(normalised_topic, BOT_NAME)
    mkdirSync(msg_path, { recursive: true })
    writeFileSync(join(msg_path, 'content.txt'), content, 'utf8')
    writeFileSync(join(msg_path, 'meta.json'), JSON.stringify({ type: type ?? 'text' }), 'utf8')

    // Auto-subscribe so replies on this topic are delivered back to this bot
    try {
      await fetch(`${ORCHESTRATOR_URL}/registry/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_name: BOT_NAME, topic_id: normalised_topic }),
      })
    } catch {
      // Non-fatal: message was written; subscription failure is logged by the orchestrator
    }

    return `Message written to topic '${normalised_topic}'`
  },
})

export const reply_to_message = tool({
  description:
    'Reply to a specific message in a topic. Creates a nested subdirectory inside the parent message directory.',
  args: {
    parent_path: tool.schema.string(
      'Absolute path of the message directory to reply to (provided in incoming YEAP messages as message_path).',
    ),
    content: tool.schema.string('Markdown reply body.'),
    type: tool.schema.string('Optional: "text" (default) | "alert" | "status"').optional(),
  },
  async execute({ parent_path, content, type }) {
    const normalised = parent_path.replace(/\\/g, '/')
    const chatRoot = CHAT_ROOT.replace(/\\/g, '/')
    if (!normalised.startsWith(chatRoot)) {
      return `Error: parent_path must be within the chat directory`
    }
    const reply_path = buildReplyPath(parent_path, BOT_NAME)
    mkdirSync(reply_path, { recursive: true })
    writeFileSync(join(reply_path, 'content.txt'), content, 'utf8')
    writeFileSync(
      join(reply_path, 'meta.json'),
      JSON.stringify({ type: type ?? 'text' }),
      'utf8',
    )
    return `Reply written.`
  },
})
