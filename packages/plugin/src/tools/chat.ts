import { tool } from '@opencode-ai/plugin'

const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'
const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] ?? 'http://orchestrator:3000'

export const write_to_chat = tool({
  description:
    'Send a message to a Mattermost channel (topic), creating the channel if it does not exist. ' +
    'Other bots subscribed to the channel will receive it.',
  args: {
    topic_id: tool.schema.string(
      'The channel to write to. Lowercase alphanumeric and hyphens, e.g. "human", "task-login-page".',
    ),
    content: tool.schema.string('Markdown message body.'),
  },
  async execute({ topic_id, content }) {
    const normalised = topic_id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
    const res = await fetch(`${ORCHESTRATOR_URL}/internal/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_name: BOT_NAME, topic_id: normalised, content }),
    })
    if (!res.ok) {
      const text = await res.text()
      return `Failed to send: ${text}`
    }
    const data = (await res.json()) as { post_id: string }
    return `Message sent to #${normalised} (post_id: ${data.post_id})`
  },
})

export const reply_to_message = tool({
  description:
    'Reply to a specific Mattermost post as a thread reply. Use the post_id from the incoming message notification.',
  args: {
    post_id: tool.schema.string('The post_id of the message to reply to (provided in incoming notifications).'),
    content: tool.schema.string('Markdown reply body.'),
  },
  async execute({ post_id, content }) {
    const res = await fetch(`${ORCHESTRATOR_URL}/internal/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_name: BOT_NAME, post_id, content }),
    })
    if (!res.ok) {
      const text = await res.text()
      return `Failed to reply: ${text}`
    }
    return 'Reply sent.'
  },
})

