/**
 * Minimal HTTP admin server at :4096.
 * Provides /health, /compact and /message endpoints used by the orchestrator.
 */
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { triggerPrompt, triggerCompact } from './harness.js'

const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'

const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok', bot_name: BOT_NAME }))

// Called by orchestrator's /spawn/compact/:name
app.post('/compact', (c) => {
  triggerCompact(
    '[YEAP SYSTEM] Please compact your conversation context now. ' +
    'Summarise all important facts, decisions, and ongoing tasks into /skillet/memory.md ' +
    '(overwrite it). After this run your full message history will be cleared — ' +
    'your next run will start fresh with only your system prompt and memory.md.',
  )
  return c.json({ ok: true })
})

// Message injection
app.post('/message', async (c) => {
  const body = await c.req.json<{ text: string }>()
  if (body.text?.trim()) triggerPrompt(body.text)
  return c.json({ ok: true })
})

export function startAdminServer(): void {
  serve({ fetch: app.fetch, port: 4096 }, () => {
    console.log(`[admin] Agent admin server listening on :4096`)
  })
}
