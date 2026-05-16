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
import { settings } from './db/schema.js'
import { eq } from 'drizzle-orm'
import { postMessage, getChannelByName } from './services/mattermost.js'

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

// Internal endpoint used by the reminder service to post MM messages
// without needing direct Mattermost credentials.
app.post('/internal/notify', async (c) => {
  const body = await c.req.json<{ channel_name: string; content: string; username?: string }>()
  if (!body.channel_name || !body.content) {
    return c.json({ error: 'channel_name and content required' }, 400)
  }

  const systemToken = db.select().from(settings).where(eq(settings.key, 'mm_system_token')).get()?.value
  const teamId = db.select().from(settings).where(eq(settings.key, 'mm_team_id')).get()?.value

  if (!systemToken || !teamId) {
    return c.json({ error: 'Not initialized' }, 503)
  }

  const channel = await getChannelByName(teamId, body.channel_name, systemToken)
  if (!channel) {
    return c.json({ error: `Channel '${body.channel_name}' not found` }, 404)
  }

  await postMessage(channel.id, body.content, systemToken)
  return c.json({ ok: true })
})

const PORT = parseInt(process.env['PORT'] ?? '3000', 10)

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Orchestrator running on port ${PORT}`)
})
