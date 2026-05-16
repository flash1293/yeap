import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { authRouter } from './routes/auth.js'
import { setupRouter } from './routes/setup.js'
import { registryRouter } from './routes/registry.js'
import { spawnRouter } from './routes/spawn.js'
import { webhookRouter } from './routes/webhook.js'
import { pwaRouter } from './routes/pwa.js'
import { botProxyRouter } from './routes/botproxy.js'
import { filesRouter } from './routes/files.js'
import { db } from './db/index.js'
import { settings, bots, subscriptions } from './db/schema.js'
import { eq } from 'drizzle-orm'
import { postMessage, getChannelByName, getOrCreateChannel, addChannelMember, getPost } from './services/mattermost.js'

const app = new Hono()

app.use('*', logger())
app.use('*', cors({ origin: '*' }))

app.get('/health', (c) => c.json({ ok: true }))

app.route('/setup', setupRouter)
app.route('/auth', authRouter)
app.route('/registry', registryRouter)
app.route('/spawn', spawnRouter)
app.route('/api/webhook', webhookRouter)
app.route('/pwa', pwaRouter)
app.route('/pwa/files', filesRouter)
app.route('/bots', botProxyRouter)

// Internal endpoint used by the reminder service to post MM messages.
app.post('/internal/notify', async (c) => {
  const body = await c.req.json<{ channel_name: string; content: string; username?: string }>()
  if (!body.channel_name || !body.content) {
    return c.json({ error: 'channel_name and content required' }, 400)
  }

  const adminToken = db.select().from(settings).where(eq(settings.key, 'mm_admin_token')).get()?.value
  const teamId = db.select().from(settings).where(eq(settings.key, 'mm_team_id')).get()?.value

  if (!adminToken || !teamId) {
    return c.json({ error: 'Not initialized' }, 503)
  }

  const channel = await getChannelByName(teamId, body.channel_name, adminToken)
  if (!channel) {
    return c.json({ error: `Channel '${body.channel_name}' not found` }, 404)
  }

  await postMessage(channel.id, body.content, adminToken)
  return c.json({ ok: true })
})

// Internal endpoint used by bots to post messages to Mattermost channels.
// Handles channel creation, bot membership, and threading.
app.post('/internal/chat', async (c) => {
  const body = await c.req.json<{
    bot_name: string
    topic_id?: string   // new message: target channel name
    post_id?: string    // thread reply: root post ID to reply to
    content: string
  }>()

  if (!body.bot_name || !body.content) {
    return c.json({ error: 'bot_name and content required' }, 400)
  }
  if (!body.topic_id && !body.post_id) {
    return c.json({ error: 'Either topic_id or post_id required' }, 400)
  }

  const adminToken = db.select().from(settings).where(eq(settings.key, 'mm_admin_token')).get()?.value
  const teamId = db.select().from(settings).where(eq(settings.key, 'mm_team_id')).get()?.value

  if (!adminToken || !teamId) {
    return c.json({ error: 'Not initialized' }, 503)
  }

  const botRow = db.select().from(bots).where(eq(bots.name, body.bot_name)).get()
  if (!botRow?.mattermost_token || !botRow.mattermost_user_id) {
    return c.json({ error: `Bot '${body.bot_name}' has no Mattermost account` }, 503)
  }

  try {
    if (body.post_id) {
      // Thread reply: look up the post to find its channel
      const post = await getPost(body.post_id, adminToken)
      if (!post) return c.json({ error: `Post '${body.post_id}' not found` }, 404)
      const rootId = post.root_id || body.post_id
      const result = await postMessage(post.channel_id, body.content, botRow.mattermost_token, rootId)
      return c.json({ post_id: result.id, channel_id: post.channel_id })
    }

    // New message: ensure channel exists, bot is a member, then post
    const topicId = body.topic_id!
    const channel = await getOrCreateChannel(teamId, topicId, topicId, 'O', adminToken)
    await addChannelMember(channel.id, botRow.mattermost_user_id, adminToken)

    // Keep orchestrator subscription table in sync for bot discovery
    db.insert(subscriptions)
      .values({ bot_id: botRow.id, topic_id: topicId })
      .onConflictDoNothing()
      .run()

    const result = await postMessage(channel.id, body.content, botRow.mattermost_token)
    return c.json({ post_id: result.id, channel_id: channel.id })
  } catch (err) {
    console.error('[/internal/chat] Error:', err)
    return c.json({ error: String(err) }, 500)
  }
})


const PORT = parseInt(process.env['PORT'] ?? '3000', 10)

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Orchestrator running on port ${PORT}`)
})
