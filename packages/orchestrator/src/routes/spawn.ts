import { Hono } from 'hono'
import { db } from '../db/index.js'
import { bots, subscriptions, spawn_log } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import { generateBotIcon } from '@yeap/shared'
import { createAndStartBotContainer, createAndStartCoordinatorContainer, allocateHostPort, stopAndRemoveBotContainer, deleteNginxBotConfig, reloadNginxBots, execInBotContainer } from '../services/docker.js'
import { getBotByName } from '../db/helpers.js'
import type { SpawnPayload } from '@yeap/shared'

export const spawnRouter = new Hono()

spawnRouter.post('/', async (c) => {
  const body = await c.req.json<SpawnPayload>()

  const nameRe = /^[a-zA-Z0-9][a-zA-Z0-9 \-]{0,30}[a-zA-Z0-9]$|^[a-zA-Z0-9]{1,2}$/
  if (!nameRe.test(body.name)) {
    return c.json({ error: 'Invalid bot name (2-32 alphanumeric/spaces/hyphens)' }, 400)
  }
  if (!body.role || !body.model) {
    return c.json({ error: 'role and model are required' }, 400)
  }

  const existing = db.select().from(bots).where(eq(bots.name, body.name)).get()
  if (existing) return c.json({ error: `A bot named '${body.name}' already exists` }, 409)

  const bot_id = uuid()
  const svg_icon = generateBotIcon(body.name)

  // Pre-insert so the bot can self-register when it starts up
  db.insert(bots)
    .values({
      id: bot_id,
      name: body.name,
      svg_icon,
      role_description: body.role,
      is_coordinator: false,
      status: 'offline',
    })
    .run()

  // Auto-subscribe bot to their personal inbox topic
  const inbox_topic = `inbox-${body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 57)}`
  db.insert(subscriptions).values({ bot_id, topic_id: inbox_topic }).onConflictDoNothing().run()
  // Also subscribe to their lowercase name so bots can address them directly
  const name_topic = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
  if (name_topic !== inbox_topic) {
    db.insert(subscriptions).values({ bot_id, topic_id: name_topic }).onConflictDoNothing().run()
  }

  // Log the spawn
  const log_id = uuid()
  db.insert(spawn_log)
    .values({
      id: log_id,
      requested_by: body.requested_by,
      bot_name: body.name,
      role: body.role,
      model: body.model,
      timestamp: Date.now(),
    })
    .run()

  let container_id: string
  const hostPort = allocateHostPort()
  try {
    container_id = await createAndStartBotContainer(body.name, body.role, hostPort)
  } catch (err) {
    // Clean up the pre-inserted bot row on container failure
    db.delete(bots).where(eq(bots.id, bot_id)).run()
    console.error('Failed to start bot container:', err)
    return c.json({ error: 'Failed to start bot container. Check Docker.' }, 500)
  }

  db.update(bots).set({ host_port: hostPort }).where(eq(bots.id, bot_id)).run()

  // Update spawn log with container id
  db.update(spawn_log).set({ container_id }).where(eq(spawn_log.id, log_id)).run()

  const bot = getBotByName(body.name)!
  return c.json({ container_id, bot })
})

spawnRouter.delete('/:name', async (c) => {
  const name = c.req.param('name')
  const bot = db.select().from(bots).where(eq(bots.name, name)).get()
  if (!bot) return c.json({ error: `Bot '${name}' not found` }, 404)
  if (bot.is_coordinator) return c.json({ error: 'Cannot tear down the coordinator' }, 403)

  try {
    await stopAndRemoveBotContainer(name)
  } catch (err) {
    console.error('Failed to stop/remove bot container:', err)
    return c.json({ error: 'Failed to stop container. Check Docker.' }, 500)
  }

  if (bot.host_port !== null) {
    deleteNginxBotConfig(bot.host_port)
    await reloadNginxBots()
  }

  // Remove bot and cascades (subscriptions) from DB
  db.delete(bots).where(eq(bots.id, bot.id)).run()

  return c.json({ ok: true, name })
})

// POST /spawn/reset/:name — recreate the container (keep volumes/memory, clear session leak cruft)
spawnRouter.post('/reset/:name', async (c) => {
  const name = c.req.param('name')
  const bot = db.select().from(bots).where(eq(bots.name, name)).get()
  if (!bot) return c.json({ error: `Bot '${name}' not found` }, 404)

  // Stop and remove the old container (volumes are named and survive)
  try {
    await stopAndRemoveBotContainer(name)
  } catch (err) {
    console.error('[reset] Failed to stop container:', err)
    return c.json({ error: 'Failed to stop container' }, 500)
  }

  // Recreate with the same role and port
  const hostPort = bot.host_port ?? allocateHostPort()
  let container_id: string
  try {
    if (bot.is_coordinator) {
      container_id = await createAndStartCoordinatorContainer(name, hostPort)
    } else {
      container_id = await createAndStartBotContainer(name, bot.role_description, hostPort)
    }
  } catch (err) {
    console.error('[reset] Failed to recreate container:', err)
    return c.json({ error: 'Failed to recreate container' }, 500)
  }

  db.update(bots)
    .set({ status: 'offline', host_port: hostPort, session_id: null, last_seen: null })
    .where(eq(bots.name, name))
    .run()

  return c.json({ ok: true, container_id })
})

// POST /spawn/compact/:name — send /compact to the bot's standing session
spawnRouter.post('/compact/:name', async (c) => {
  const name = c.req.param('name')
  const bot = db.select().from(bots).where(eq(bots.name, name)).get()
  if (!bot) return c.json({ error: `Bot '${name}' not found` }, 404)
  if (!bot.opencode_url || !bot.session_id) {
    return c.json({ error: 'Bot is not online or has no session' }, 409)
  }

  const endpoint = `${bot.opencode_url}/session/${bot.session_id}/message`
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ type: 'text', text: '/compact' }] }),
    })
    if (!res.ok && res.status !== 204) {
      const txt = await res.text()
      console.error(`[compact] OpenCode returned ${res.status}: ${txt}`)
      return c.json({ error: `OpenCode responded ${res.status}` }, 502)
    }
  } catch (err) {
    console.error('[compact] Fetch failed:', err)
    return c.json({ error: 'Failed to reach bot' }, 502)
  }

  db.update(bots)
    .set({ messages_since_compact: 0, last_compact_at: Date.now() })
    .where(eq(bots.name, name))
    .run()

  return c.json({ ok: true })
})

// POST /spawn/compact-check/:name — called by reminder after each delivery
// Increments the counter and triggers /compact when threshold is reached
const AUTO_COMPACT_THRESHOLD = 50

spawnRouter.post('/compact-check/:name', async (c) => {
  const name = c.req.param('name')
  const bot = db.select().from(bots).where(eq(bots.name, name)).get()
  if (!bot) return c.json({ ok: true }) // silently ignore unknown bots

  const newCount = (bot.messages_since_compact ?? 0) + 1
  db.update(bots)
    .set({ messages_since_compact: newCount })
    .where(eq(bots.name, name))
    .run()

  if (newCount >= AUTO_COMPACT_THRESHOLD && bot.opencode_url && bot.session_id) {
    console.log(`[compact-check] Auto-compacting ${name} at ${newCount} messages`)
    const endpoint = `${bot.opencode_url}/session/${bot.session_id}/message`
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: [{ type: 'text', text: '/compact' }] }),
      })
      db.update(bots)
        .set({ messages_since_compact: 0, last_compact_at: Date.now() })
        .where(eq(bots.name, name))
        .run()
    } catch (err) {
      console.error(`[compact-check] Failed to auto-compact ${name}:`, err)
    }
  }

  return c.json({ ok: true })
})

// POST /spawn/exec/:name — run a shell script inside the bot's container
spawnRouter.post('/exec/:name', async (c) => {
  const name = c.req.param('name')
  const bot = db.select().from(bots).where(eq(bots.name, name)).get()
  if (!bot) return c.json({ error: `Bot '${name}' not found` }, 404)

  const body = await c.req.json<{ script: string; timeout_ms?: number }>()
  if (!body.script || typeof body.script !== 'string') {
    return c.json({ error: 'script required' }, 400)
  }
  if (body.script.length > 4096) {
    return c.json({ error: 'script too long (max 4096 chars)' }, 400)
  }

  try {
    const result = await execInBotContainer(name, body.script, body.timeout_ms ?? 30_000)
    return c.json(result)
  } catch (err) {
    console.error(`[exec] Failed for ${name}:`, err)
    return c.json({ error: String(err) }, 502)
  }
})
