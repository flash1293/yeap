import { Hono } from 'hono'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildMessagePath, formatTimestamp, CHAT_ROOT } from '@yeap/shared'
import type { WebhookPayload } from '@yeap/shared'

export const webhookRouter = new Hono()

webhookRouter.post('/:topicId', async (c) => {
  const topicId = c.req.param('topicId')

  if (!/^[a-z0-9\-]{1,64}$/.test(topicId)) {
    return c.json({ error: 'Invalid topic ID' }, 400)
  }

  let payload: WebhookPayload = {}
  try {
    payload = await c.req.json<WebhookPayload>()
  } catch {
    // Not JSON — use empty object
  }

  const msg_path = buildMessagePath(topicId, 'Webhook_Alert')
  mkdirSync(msg_path, { recursive: true })
  writeFileSync(join(msg_path, 'content.txt'), JSON.stringify(payload, null, 2), 'utf8')
  writeFileSync(
    join(msg_path, 'meta.json'),
    JSON.stringify({ type: 'alert' }),
    'utf8',
  )

  return new Response(null, { status: 204 })
})
