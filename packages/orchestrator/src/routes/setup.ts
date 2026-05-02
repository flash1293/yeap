import { Hono } from 'hono'
import { db } from '../db/index.js'
import { bots, subscriptions, settings } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { hash } from 'bcryptjs'
import { v4 as uuid } from 'uuid'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { generateBotIcon } from '@yeap/shared'
import { createAndStartCoordinatorContainer, allocateHostPort } from '../services/docker.js'
import { writeYeapDocs } from '../services/docs.js'
import type { SetupInitPayload } from '@yeap/shared'

const COORDINATOR_ROLE =
  'You are the coordinator of this YEAP installation. Your job is to be the ' +
  'primary point of contact for the human. Understand their goals, determine ' +
  'what specialist bots are needed, spawn them when necessary, delegate tasks ' +
  'via FSAD topics, and report progress and results back to the human.'

export const setupRouter = new Hono()

setupRouter.get('/status', (c) => {
  const row = db.select().from(settings).where(eq(settings.key, 'initialized')).get()
  return c.json({ initialized: row?.value === '1' })
})

setupRouter.post('/init', async (c) => {
  // Block if already initialized
  const existing = db.select().from(settings).where(eq(settings.key, 'initialized')).get()
  if (existing?.value === '1') {
    return c.json({ error: 'Already initialized' }, 400)
  }

  const body = await c.req.json<SetupInitPayload>()

  // Validate coordinator name
  const nameRe = /^[a-zA-Z0-9][a-zA-Z0-9 \-]{0,30}[a-zA-Z0-9]$|^[a-zA-Z0-9]{1,2}$/
  if (!nameRe.test(body.coordinator_name)) {
    return c.json({ error: 'Invalid coordinator name (2-32 alphanumeric/spaces/hyphens)' }, 400)
  }

  const existing_bot = db
    .select()
    .from(bots)
    .where(eq(bots.name, body.coordinator_name))
    .get()
  if (existing_bot) {
    return c.json({ error: 'A bot with that name already exists' }, 409)
  }

  if (!body.pwa_password || body.pwa_password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }
  if (!body.model) {
    return c.json({ error: 'Model is required' }, 400)
  }
  if (!body.api_key && body.provider !== 'ollama') {
    return c.json({ error: 'API key is required' }, 400)
  }

  const password_hash = await hash(body.pwa_password, 12)
  const secrets_path = process.env['SECRETS_PATH'] ?? '/data/secrets.json'

  // Write secrets
  mkdirSync(dirname(secrets_path), { recursive: true })
  writeFileSync(
    secrets_path,
    JSON.stringify({ provider: body.provider, model: body.model, api_key: body.api_key }),
    'utf8',
  )

  // Store password hash
  db.insert(settings)
    .values({ key: 'password_hash', value: password_hash })
    .onConflictDoUpdate({ target: settings.key, set: { value: password_hash } })
    .run()

  // Create coordinator bot record
  const bot_id = uuid()
  const svg_icon = generateBotIcon(body.coordinator_name)

  db.insert(bots)
    .values({
      id: bot_id,
      name: body.coordinator_name,
      svg_icon,
      role_description: COORDINATOR_ROLE,
      is_coordinator: true,
      status: 'offline',
    })
    .run()

  db.insert(subscriptions).values({ bot_id, topic_id: 'human' }).run()

  // Auto-subscribe coordinator to their personal inbox topic
  const inbox_topic = `inbox-${body.coordinator_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 57)}`
  db.insert(subscriptions).values({ bot_id, topic_id: inbox_topic }).onConflictDoNothing().run()

  // Start the coordinator container
  const hostPort = allocateHostPort()
  try {
    await createAndStartCoordinatorContainer(body.coordinator_name, hostPort)
  } catch (err) {
    console.error('Failed to start coordinator container:', err)
    // Return error but leave db state; operator can retry
    return c.json({ error: 'Failed to start coordinator container. Check Docker.' }, 500)
  }

  db.update(bots)
    .set({ host_port: hostPort })
    .where(eq(bots.name, body.coordinator_name))
    .run()

  // Write platform docs
  writeYeapDocs()

  // Mark initialized
  db.insert(settings)
    .values({ key: 'initialized', value: '1' })
    .onConflictDoUpdate({ target: settings.key, set: { value: '1' } })
    .run()

  return c.json({ ok: true })
})
