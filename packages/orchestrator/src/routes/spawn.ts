import { Hono } from 'hono'
import { db } from '../db/index.js'
import { bots, subscriptions, spawn_log, settings } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import { generateBotIcon } from '@yeap/shared'
import {
  createAndStartBotContainer,
  createAndStartCoordinatorContainer,
  stopAndRemoveBotContainer,
  execInBotContainer,
  agentAdminUrl,
} from '../services/docker.js'
import {
  createBotUser,
  disableBotUser,
  getOrCreateChannel,
  addChannelMember,
} from '../services/mattermost.js'
import { getBotByName } from '../db/helpers.js'
import type { SpawnPayload } from '@yeap/shared'

export const spawnRouter = new Hono()

function getSettingOrThrow(key: string): string {
  const row = db.select().from(settings).where(eq(settings.key, key)).get()
  if (!row) throw new Error(`Setting '${key}' not configured — is setup complete?`)
  return row.value
}

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

  const inbox_topic = `inbox-${body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 57)}`
  db.insert(subscriptions).values({ bot_id, topic_id: inbox_topic }).onConflictDoNothing().run()
  const name_topic = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
  if (name_topic !== inbox_topic) {
    db.insert(subscriptions).values({ bot_id, topic_id: name_topic }).onConflictDoNothing().run()
  }

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

  // ── Create Mattermost bot identity ────────────────────────────────────────
  let mmToken: string
  let mmUserId: string
  try {
    const adminToken = getSettingOrThrow('mm_admin_token')
    const teamId = getSettingOrThrow('mm_team_id')
    const humanChannelId = getSettingOrThrow('mm_human_channel_id')
    const slug = body.name.toLowerCase().replace(/[\s_]+/g, '-')

    const mmBot = await createBotUser(
      `yeap-bot-${slug}`,
      body.name,
      body.role.slice(0, 128),
      adminToken,
      teamId,
    )
    mmToken = mmBot.token
    mmUserId = mmBot.user_id

    // Add to human channel so the bot can see the human channel
    await addChannelMember(humanChannelId, mmUserId, adminToken)

    // Create inbox channel and add bot
    const inboxChannel = await getOrCreateChannel(
      teamId,
      inbox_topic,
      `Inbox - ${body.name}`,
      'P',
      adminToken,
    )
    await addChannelMember(inboxChannel.id, mmUserId, adminToken)

    db.update(bots)
      .set({
        mattermost_user_id: mmUserId,
        mattermost_token: mmToken,
        opencode_url: agentAdminUrl(body.name),
      })
      .where(eq(bots.id, bot_id))
      .run()
  } catch (err) {
    db.delete(bots).where(eq(bots.id, bot_id)).run()
    console.error('Failed to create Mattermost bot:', err)
    return c.json({ error: `Failed to create Mattermost bot: ${String(err)}` }, 500)
  }

  // ── Start container ───────────────────────────────────────────────────────
  let container_id: string
  try {
    const teamId = db.select().from(settings).where(eq(settings.key, 'mm_team_id')).get()?.value
    container_id = await createAndStartBotContainer(body.name, body.role, mmToken!, mmUserId!, teamId)
  } catch (err) {
    db.delete(bots).where(eq(bots.id, bot_id)).run()
    console.error('Failed to start bot container:', err)
    return c.json({ error: 'Failed to start bot container. Check Docker.' }, 500)
  }

  db.update(spawn_log).set({ container_id }).where(eq(spawn_log.id, log_id)).run()

  const bot = getBotByName(body.name)!
  return c.json({ container_id, bot }, 201)
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

  // Disable Mattermost bot user
  if (bot.mattermost_user_id) {
    try {
      const adminToken = db.select().from(settings).where(eq(settings.key, 'mm_admin_token')).get()?.value
      if (adminToken) await disableBotUser(bot.mattermost_user_id, adminToken)
    } catch (err) {
      console.warn('[teardown] Failed to disable MM bot:', err)
    }
  }

  db.delete(bots).where(eq(bots.id, bot.id)).run()
  return c.json({ ok: true, name })
})

async function resetBot(
  name: string,
  bot: typeof import('../db/schema.js').bots.$inferSelect,
): Promise<string> {
  await stopAndRemoveBotContainer(name)
  const mmToken = bot.mattermost_token ?? ''
  const mmUserId = bot.mattermost_user_id ?? ''
  const teamId = db.select().from(settings).where(eq(settings.key, 'mm_team_id')).get()?.value
  const container_id = bot.is_coordinator
    ? await createAndStartCoordinatorContainer(name, mmToken, mmUserId, teamId)
    : await createAndStartBotContainer(name, bot.role_description, mmToken, mmUserId, teamId)
  db.update(bots)
    .set({ status: 'offline', session_id: null, last_seen: null, messages_since_compact: 0 })
    .where(eq(bots.name, name))
    .run()
  return container_id
}

spawnRouter.post('/reset/:name', async (c) => {
  const name = c.req.param('name')
  const bot = db.select().from(bots).where(eq(bots.name, name)).get()
  if (!bot) return c.json({ error: `Bot '${name}' not found` }, 404)

  let container_id: string
  try {
    container_id = await resetBot(name, bot)
  } catch (err) {
    console.error('[reset] Failed:', err)
    return c.json({ error: 'Failed to reset container' }, 500)
  }

  return c.json({ ok: true, container_id })
})

// POST /spawn/compact/:name — trigger compaction on the agent admin server
spawnRouter.post('/compact/:name', async (c) => {
  const name = c.req.param('name')
  const bot = db.select().from(bots).where(eq(bots.name, name)).get()
  if (!bot) return c.json({ error: `Bot '${name}' not found` }, 404)
  if (!bot.opencode_url) {
    return c.json({ error: 'Bot has no admin URL — is it online?' }, 409)
  }

  try {
    const res = await fetch(`${bot.opencode_url}/compact`, { method: 'POST' })
    if (!res.ok) {
      const txt = await res.text()
      console.error(`[compact] Agent returned ${res.status}: ${txt}`)
      return c.json({ error: `Agent responded ${res.status}` }, 502)
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

const AUTO_COMPACT_THRESHOLD = 10

spawnRouter.post('/compact-check/:name', async (c) => {
  const name = c.req.param('name')
  const bot = db.select().from(bots).where(eq(bots.name, name)).get()
  if (!bot) return c.json({ ok: true })

  const newCount = (bot.messages_since_compact ?? 0) + 1
  db.update(bots).set({ messages_since_compact: newCount }).where(eq(bots.name, name)).run()

  if (newCount >= AUTO_COMPACT_THRESHOLD && bot.opencode_url) {
    console.log(`[compact-check] Auto-compacting ${name} at ${newCount} messages`)
    try {
      const res = await fetch(`${bot.opencode_url}/compact`, { method: 'POST' })
      if (res.ok) {
        db.update(bots)
          .set({ messages_since_compact: 0, last_compact_at: Date.now() })
          .where(eq(bots.name, name))
          .run()
      }
    } catch (err) {
      console.error(`[compact-check] Failed to auto-compact ${name}:`, err)
    }
  }

  return c.json({ ok: true })
})

spawnRouter.post('/clear-session/:name', async (c) => {
  const name = c.req.param('name')
  const bot = db.select().from(bots).where(eq(bots.name, name)).get()
  if (!bot) return c.json({ error: `Bot '${name}' not found` }, 404)

  try {
    await execInBotContainer(name, 'rm -f /skillet/session.jsonl', 5000)
  } catch { /* already gone */ }

  let container_id: string
  try {
    container_id = await resetBot(name, bot)
  } catch (err) {
    console.error('[clear-session] Failed:', err)
    return c.json({ error: 'Failed to reset container' }, 500)
  }

  return c.json({ ok: true, container_id })
})

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

