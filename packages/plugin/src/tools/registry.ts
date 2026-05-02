import { tool } from '@opencode-ai/plugin'
import type { Bot } from '@yeap/shared'

const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] ?? 'http://orchestrator:3000'
const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'

export const query_bots = tool({
  description: 'List all known bots in the YEAP registry, with their names, roles, and current status.',
  args: {
    topic_id: tool.schema.string('Optional: filter to only bots subscribed to this topic.').optional(),
  },
  async execute({ topic_id }) {
    const url = new URL(`${ORCHESTRATOR_URL}/registry/bots`)
    if (topic_id) url.searchParams.set('topic', topic_id)
    const res = await fetch(url)
    const bots = (await res.json()) as Bot[]
    if (!bots.length) return 'No bots found.'
    return bots
      .map((b) => `Name: ${b.name} | Role: ${b.role_description} | Status: ${b.status}`)
      .join('\n')
  },
})

export const update_status = tool({
  description:
    "Update this bot's status. Use ONLY 'online', 'offline', or 'busy' as the status value. " +
    "Do not put descriptions or sentences here — this is a presence indicator shown as a colour dot in the UI. " +
    "To describe what you are currently doing, include that in your message to the human topic instead.",
  args: {
    status: tool.schema.string("Must be exactly one of: 'online', 'offline', 'busy'."),
  },
  async execute({ status }) {
    await fetch(`${ORCHESTRATOR_URL}/registry/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: BOT_NAME, status }),
    })
    return `Status updated to: ${status}`
  },
})

export const subscribe_topic = tool({
  description:
    'Subscribe this bot to a FSAD topic. Must be called before the bot can reliably receive messages on it.',
  args: {
    topic_id: tool.schema.string('Topic to subscribe to.'),
  },
  async execute({ topic_id }) {
    await fetch(`${ORCHESTRATOR_URL}/registry/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_name: BOT_NAME, topic_id }),
    })
    return `Subscribed to topic '${topic_id}'`
  },
})

export const unsubscribe_topic = tool({
  description: 'Unsubscribe this bot from a FSAD topic.',
  args: {
    topic_id: tool.schema.string('Topic to unsubscribe from.'),
  },
  async execute({ topic_id }) {
    await fetch(`${ORCHESTRATOR_URL}/registry/subscribe`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_name: BOT_NAME, topic_id }),
    })
    return `Unsubscribed from topic '${topic_id}'`
  },
})
