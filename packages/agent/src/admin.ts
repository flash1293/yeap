/**
 * Minimal HTTP admin server at :4096.
 * Provides /health, /compact and /message endpoints used by the orchestrator.
 */
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { triggerPrompt } from './harness.js'

const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'

const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok', bot_name: BOT_NAME }))

// Called by orchestrator's /spawn/compact/:name
app.post('/compact', (c) => {
  triggerPrompt(
    '[YEAP SYSTEM] Please compact your conversation context now. ' +
    'Summarise completed work into /skillet/memory.md, then your context will be cleared.',
  )
  return c.json({ ok: true })
})

// Legacy compat: orchestrator used to call /session/:id/compact and /session/:id/prompt_async
app.post('/session/:id/compact', (c) => {
  triggerPrompt(
    '[YEAP SYSTEM] Please compact your conversation context now. ' +
    'Summarise completed work into /skillet/memory.md.',
  )
  return c.json({ ok: true })
})

app.post('/session/:id/prompt_async', async (c) => {
  const body = await c.req.json<{ parts?: Array<{ type: string; text?: string }> }>()
  const text = body.parts?.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n') ?? ''
  if (text.trim()) triggerPrompt(text)
  return new Response(null, { status: 204 })
})

// Direct message injection (new API)
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
