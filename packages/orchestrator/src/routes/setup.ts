import { Hono } from 'hono'
import { db } from '../db/index.js'
import { bots, subscriptions, settings } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { hash } from 'bcryptjs'
import { v4 as uuid } from 'uuid'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { generateBotIcon } from '@yeap/shared'
import {
  createAndStartCoordinatorContainer,
  writeHtpasswd,
  agentAdminUrl,
} from '../services/docker.js'
import { writeYeapDocs } from '../services/docs.js'
import {
  waitForMattermost,
  createAdminUser,
  createTeam,
  createBotUser,
  getOrCreateChannel,
  addChannelMember,
  updateSiteUrl,
} from '../services/mattermost.js'
import type { SetupInitPayload } from '@yeap/shared'

const COORDINATOR_ROLE =
  'You are the coordinator of this YEAP installation. Your job is to be the ' +
  'primary point of contact for the human. Understand their goals, determine ' +
  'what specialist bots are needed, spawn them when necessary, delegate tasks ' +
  'via Mattermost channels, and report progress and results back to the human.'

export const setupRouter = new Hono()

setupRouter.get('/status', (c) => {
  const row = db.select().from(settings).where(eq(settings.key, 'initialized')).get()
  return c.json({ initialized: row?.value === '1' })
})

setupRouter.post('/init', async (c) => {
  const existing = db.select().from(settings).where(eq(settings.key, 'initialized')).get()
  if (existing?.value === '1') {
    return c.json({ error: 'Already initialized' }, 400)
  }

  const body = await c.req.json<SetupInitPayload>()

  const nameRe = /^[a-zA-Z0-9][a-zA-Z0-9 \-]{0,30}[a-zA-Z0-9]$|^[a-zA-Z0-9]{1,2}$/
  if (!nameRe.test(body.coordinator_name)) {
    return c.json({ error: 'Invalid coordinator name (2-32 alphanumeric/spaces/hyphens)' }, 400)
  }

  const existing_bot = db.select().from(bots).where(eq(bots.name, body.coordinator_name)).get()
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
  if (body.base_url && !/^https?:\/\/.+/.test(body.base_url)) {
    return c.json({ error: 'Invalid base URL' }, 400)
  }
  if (body.provider === 'litellm' && !body.base_url) {
    return c.json({ error: 'LiteLLM endpoint URL is required' }, 400)
  }

  // ── Mattermost setup ──────────────────────────────────────────────────────
  const mmAdminEmail = body.mm_admin_email ?? 'admin@yeap.local'
  const mmAdminUsername = body.mm_admin_username ?? 'yeap-admin'
  const mmAdminPassword = body.mm_admin_password ?? body.pwa_password

  let mmAdminToken = ''
  let mmTeamId = ''
  let mmSystemToken = ''
  let mmSystemUserId = ''
  let mmHumanChannelId = ''

  try {
    console.log('[setup] Waiting for Mattermost...')
    await waitForMattermost()

    console.log('[setup] Creating MM admin user...')
    const admin = await createAdminUser(mmAdminEmail, mmAdminUsername, mmAdminPassword)
    mmAdminToken = admin.token

    console.log('[setup] Creating yeap team...')
    const team = await createTeam('yeap', 'Yeap', mmAdminToken, 'I')
    mmTeamId = team.id

    const siteUrl = process.env['MATTERMOST_SITE_URL']
    if (siteUrl) await updateSiteUrl(siteUrl, mmAdminToken)

    console.log('[setup] Creating yeap-system bot...')
    const systemBot = await createBotUser(
      'yeap-system',
      'Yeap System',
      'System bot for reminders and alerts',
      mmAdminToken,
      mmTeamId,
    )
    mmSystemToken = systemBot.token
    mmSystemUserId = systemBot.user_id

    console.log('[setup] Creating human channel...')
    const humanChannel = await getOrCreateChannel(mmTeamId, 'human', 'Human', 'O', mmAdminToken)
    mmHumanChannelId = humanChannel.id
    await addChannelMember(mmHumanChannelId, mmSystemUserId, mmAdminToken)
  } catch (err) {
    console.error('[setup] Mattermost init failed:', err)
    return c.json({ error: `Mattermost setup failed: ${String(err)}` }, 500)
  }

  // ── Persist secrets ───────────────────────────────────────────────────────
  const password_hash = await hash(body.pwa_password, 12)
  const secrets_path = process.env['SECRETS_PATH'] ?? '/data/secrets.json'

  mkdirSync(dirname(secrets_path), { recursive: true })
  writeFileSync(
    secrets_path,
    JSON.stringify({
      provider: body.provider,
      model: body.model,
      api_key: body.api_key,
      base_url: body.base_url,
      context_window: body.context_window,
      max_output: body.max_output,
    }),
    'utf8',
  )

  db.insert(settings)
    .values({ key: 'password_hash', value: password_hash })
    .onConflictDoUpdate({ target: settings.key, set: { value: password_hash } })
    .run()
  writeHtpasswd(body.pwa_password)

  for (const [key, value] of [
    ['mm_admin_token', mmAdminToken],
    ['mm_admin_email', mmAdminEmail],
    ['mm_system_token', mmSystemToken],
    ['mm_system_user_id', mmSystemUserId],
    ['mm_team_id', mmTeamId],
    ['mm_human_channel_id', mmHumanChannelId],
  ] as const) {
    db.insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run()
  }

  // ── Create coordinator DB record ──────────────────────────────────────────
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

  db.insert(subscriptions).values({ bot_id, topic_id: 'human' }).onConflictDoNothing().run()
  const inbox_topic = `inbox-${body.coordinator_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 57)}`
  db.insert(subscriptions).values({ bot_id, topic_id: inbox_topic }).onConflictDoNothing().run()

  // ── Create coordinator Mattermost bot ─────────────────────────────────────
  let coordMmToken = ''
  let coordMmUserId = ''
  try {
    const slug = body.coordinator_name.toLowerCase().replace(/[\s_]+/g, '-')
    const coordBot = await createBotUser(
      `yeap-bot-${slug}`,
      body.coordinator_name,
      COORDINATOR_ROLE.slice(0, 128),
      mmAdminToken,
      mmTeamId,
    )
    coordMmToken = coordBot.token
    coordMmUserId = coordBot.user_id

    await addChannelMember(mmHumanChannelId, coordMmUserId, mmAdminToken)

    const inboxChannel = await getOrCreateChannel(
      mmTeamId,
      inbox_topic,
      `Inbox - ${body.coordinator_name}`,
      'P',
      mmAdminToken,
    )
    await addChannelMember(inboxChannel.id, coordMmUserId, mmAdminToken)

    db.update(bots)
      .set({
        mattermost_user_id: coordMmUserId,
        mattermost_token: coordMmToken,
        admin_url: agentAdminUrl(body.coordinator_name),
      })
      .where(eq(bots.id, bot_id))
      .run()
  } catch (err) {
    console.error('[setup] Failed to create coordinator MM user:', err)
    return c.json({ error: `Coordinator Mattermost account failed: ${String(err)}` }, 500)
  }

  // ── Start coordinator container ───────────────────────────────────────────
  try {
    await createAndStartCoordinatorContainer(body.coordinator_name, coordMmToken, coordMmUserId, mmTeamId)
  } catch (err) {
    console.error('Failed to start coordinator container:', err)
    return c.json({ error: 'Failed to start coordinator container. Check Docker.' }, 500)
  }

  writeYeapDocs()

  db.insert(settings)
    .values({ key: 'initialized', value: '1' })
    .onConflictDoUpdate({ target: settings.key, set: { value: '1' } })
    .run()

  return c.json({ ok: true })
})
