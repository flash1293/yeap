import { Hono } from 'hono'
import { db } from '../db/index.js'
import { settings } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { postMessage, getChannelByName } from '../services/mattermost.js'
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

  const adminToken = db.select().from(settings).where(eq(settings.key, 'mm_admin_token')).get()?.value
  const teamId = db.select().from(settings).where(eq(settings.key, 'mm_team_id')).get()?.value

  if (!adminToken || !teamId) {
    return c.json({ error: 'Mattermost not configured — run setup first' }, 503)
  }

  const channel = await getChannelByName(teamId, topicId, adminToken)
  if (!channel) {
    return c.json({ error: `Channel '${topicId}' not found in Mattermost` }, 404)
  }

  const message = typeof payload['text'] === 'string'
    ? payload['text']
    : `**Webhook alert**\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``

  await postMessage(channel.id, message, adminToken)

  return new Response(null, { status: 204 })
})

