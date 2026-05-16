import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { remindersRouter } from './routes/reminders.js'
import { startScheduler } from './scheduler.js'

const app = new Hono()

app.use('*', logger())
app.use('*', cors({ origin: '*' }))

app.get('/health', (c) => c.json({ ok: true }))
app.route('/reminders', remindersRouter)

const PORT = parseInt(process.env['PORT'] ?? '3001', 10)

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Reminder service running on port ${PORT}`)
  startScheduler()
})

