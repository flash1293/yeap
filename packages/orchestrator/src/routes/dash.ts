import { Hono } from 'hono'
import { db } from '../db/index.js'
import { bots, settings } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth.js'
import { postMessage, getChannelByName } from '../services/mattermost.js'

export const dashRouter = new Hono()

dashRouter.use('*', requireAuth)

// POST /dash/:name/message — send a message to a bot's inbox on behalf of a dashboard
dashRouter.post('/:name/message', async (c) => {
  const name = c.req.param('name')
  const body = await c.req.json<{ message?: unknown }>()

  if (typeof body.message !== 'string' || !body.message.trim()) {
    return c.json({ error: 'message must be a non-empty string' }, 400)
  }

  const bot = db.select().from(bots).where(eq(bots.name, name)).get()
  if (!bot) {
    return c.json({ error: `Bot '${name}' not found` }, 404)
  }

  const adminToken = db.select().from(settings).where(eq(settings.key, 'mm_admin_token')).get()?.value
  const teamId = db.select().from(settings).where(eq(settings.key, 'mm_team_id')).get()?.value

  if (!adminToken || !teamId) {
    return c.json({ error: 'Mattermost not configured' }, 503)
  }

  const inboxTopic = `inbox-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 57)}`
  const channel = await getChannelByName(teamId, inboxTopic, adminToken)
  if (!channel) {
    return c.json({ error: `Inbox channel for '${name}' not found` }, 404)
  }

  await postMessage(channel.id, `[Dashboard] ${body.message.trim()}`, adminToken)

  return c.json({ ok: true })
})
