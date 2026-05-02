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

const PORT = parseInt(process.env['PORT'] ?? '3000', 10)

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Orchestrator running on port ${PORT}`)
})
