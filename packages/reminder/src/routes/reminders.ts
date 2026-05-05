import { Hono } from 'hono'
import { db, reminders } from '../scheduler.js'
import { eq } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import type { SetReminderPayload, Reminder } from '@yeap/shared'
// @ts-ignore
import cronParser from 'cron-parser'

export const remindersRouter = new Hono()

remindersRouter.post('/', async (c) => {
  const body = await c.req.json<SetReminderPayload>()

  // Validate scheduling: exactly one method.
  // Treat 0 and "" as absent — models often send zero-valued optional fields.
  const hasDelayMs = typeof body.delay_ms === 'number' && body.delay_ms > 0
  const hasFireAt = typeof body.fire_at === 'number' && body.fire_at > 0
  const hasCron = typeof body.cron === 'string' && body.cron.trim() !== ''
  if ([hasDelayMs, hasFireAt, hasCron].filter(Boolean).length !== 1) {
    return c.json({ error: 'Provide exactly one of: delay_ms (>0), fire_at (>0), cron (non-empty)' }, 400)
  }
  if (!body.bot_name) return c.json({ error: 'bot_name required' }, 400)
  if (!body.topic_id || !/^[a-z0-9\-]{1,64}$/.test(body.topic_id)) {
    return c.json({ error: 'Invalid topic_id' }, 400)
  }
  if (!body.content || body.content.length > 4096) {
    return c.json({ error: 'content required (max 4096 chars)' }, 400)
  }
  if (body.script !== undefined && (typeof body.script !== 'string' || body.script.length > 4096)) {
    return c.json({ error: 'script must be a string (max 4096 chars)' }, 400)
  }

  const now = Date.now()
  let fire_at: number | null = null
  let cron: string | null = null
  let next_fire_at: number | null = null

  if (hasDelayMs) {
    fire_at = now + body.delay_ms!
  } else if (hasFireAt) {
    if (body.fire_at! <= now) return c.json({ error: 'fire_at must be in the future' }, 400)
    fire_at = body.fire_at!
  } else if (hasCron) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      next_fire_at = (cronParser.parseExpression(body.cron!.trim()).next() as { getTime(): number }).getTime()
      cron = body.cron!.trim()
    } catch {
      return c.json({ error: 'Invalid cron expression' }, 400)
    }
  }

  const id = uuid()
  const row = {
    id,
    bot_name: body.bot_name,
    topic_id: body.topic_id,
    content: body.content,
    fire_at,
    cron,
    next_fire_at,
    created_at: now,
    author_mode: body.author_mode ?? 'Reminder',
    meta_type: body.meta_type ?? 'alert',
    script: body.script ?? null,
  } satisfies typeof reminders.$inferInsert

  db.insert(reminders).values(row).run()

  return c.json(row as Reminder, 201)
})

remindersRouter.get('/', (c) => {
  const bot_name = c.req.query('bot_name')
  const rows = bot_name
    ? db.select().from(reminders).where(eq(reminders.bot_name, bot_name)).all()
    : db.select().from(reminders).all()
  return c.json(rows)
})

remindersRouter.delete('/:id', (c) => {
  const id = c.req.param('id')
  const row = db.select().from(reminders).where(eq(reminders.id, id)).get()
  if (!row) return c.json({ error: 'Not found' }, 404)
  db.delete(reminders).where(eq(reminders.id, id)).run()
  return c.json({ ok: true })
})
