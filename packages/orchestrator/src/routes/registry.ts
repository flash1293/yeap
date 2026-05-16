import { Hono } from 'hono'
import { db } from '../db/index.js'
import { bots, subscriptions } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { queryBots, getBotByName } from '../db/helpers.js'
import type {
  RegisterBotPayload,
  UpdateBotPayload,
  UpdateStatusPayload,
  SubscribePayload,
  UnsubscribePayload,
} from '@yeap/shared'
import { and } from 'drizzle-orm'

export const registryRouter = new Hono()

// GET /registry/bots  — list bots, optional ?topic= and ?exclude=
registryRouter.get('/bots', (c) => {
  const topic = c.req.query('topic')
  const exclude = c.req.query('exclude')
  const result = queryBots({
    ...(topic !== undefined ? { topic } : {}),
    ...(exclude !== undefined ? { exclude } : {}),
  })
  return c.json(result)
})

// GET /registry/bots/:name  — get single bot (used by plugins to fetch subscriptions)
registryRouter.get('/bots/:name', (c) => {
  const name = c.req.param('name')
  const bot = getBotByName(name)
  if (!bot) return c.json({ error: 'Bot not found' }, 404)
  return c.json({ bot })
})

// POST /registry/bots  — bot self-registers (called by agent on startup)
registryRouter.post('/bots', async (c) => {
  const body = await c.req.json<RegisterBotPayload>()
  if (!body.name) {
    return c.json({ error: 'name is required' }, 400)
  }

  const row = db.select().from(bots).where(eq(bots.name, body.name)).get()
  if (!row) return c.json({ error: 'Bot not found in registry' }, 404)

  db.update(bots)
    .set({
      ...(body.opencode_url !== undefined ? { opencode_url: body.opencode_url } : {}),
      role_description: body.role_description || row.role_description,
      status: 'online',
      last_seen: Date.now(),
    })
    .where(eq(bots.name, body.name))
    .run()

  const bot = getBotByName(body.name)
  return c.json({ bot })
})

// PATCH /registry/bots/:name  — partial update
registryRouter.patch('/bots/:name', async (c) => {
  const name = c.req.param('name')
  const body = await c.req.json<UpdateBotPayload>()

  const row = db.select().from(bots).where(eq(bots.name, name)).get()
  if (!row) return c.json({ error: 'Bot not found' }, 404)

  const updates: Partial<typeof bots.$inferInsert> = { last_seen: Date.now() }
  if (body.status !== undefined) updates.status = body.status
  if (body.session_id !== undefined) updates.session_id = body.session_id
  if (body.opencode_url !== undefined) updates.opencode_url = body.opencode_url

  db.update(bots).set(updates).where(eq(bots.name, name)).run()

  const bot = getBotByName(name)
  return c.json(bot)
})

// POST /registry/status  — shorthand status update
registryRouter.post('/status', async (c) => {
  const body = await c.req.json<UpdateStatusPayload>()
  if (!body.name || !body.status) {
    return c.json({ error: 'name and status required' }, 400)
  }

  const row = db.select().from(bots).where(eq(bots.name, body.name)).get()
  if (!row) return c.json({ error: 'Bot not found' }, 404)

  db.update(bots)
    .set({ status: body.status, last_seen: Date.now() })
    .where(eq(bots.name, body.name))
    .run()

  return c.json(getBotByName(body.name))
})

// POST /registry/subscribe
registryRouter.post('/subscribe', async (c) => {
  const body = await c.req.json<SubscribePayload>()
  const row = db.select().from(bots).where(eq(bots.name, body.bot_name)).get()
  if (!row) return c.json({ error: 'Bot not found' }, 404)

  db.insert(subscriptions)
    .values({ bot_id: row.id, topic_id: body.topic_id })
    .onConflictDoNothing()
    .run()

  return c.json({ ok: true })
})

// DELETE /registry/subscribe
registryRouter.delete('/subscribe', async (c) => {
  const body = await c.req.json<UnsubscribePayload>()
  const row = db.select().from(bots).where(eq(bots.name, body.bot_name)).get()
  if (!row) return c.json({ error: 'Bot not found' }, 404)

  db.delete(subscriptions)
    .where(
      and(eq(subscriptions.bot_id, row.id), eq(subscriptions.topic_id, body.topic_id)),
    )
    .run()

  return c.json({ ok: true })
})
