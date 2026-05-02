import { Hono } from 'hono'
import { db } from '../db/index.js'
import { settings } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { compare } from 'bcryptjs'
import { signToken } from '../middleware/auth.js'
import type { LoginPayload } from '@yeap/shared'

export const authRouter = new Hono()

authRouter.post('/login', async (c) => {
  const body = await c.req.json<LoginPayload>()
  if (!body.password) return c.json({ error: 'Password required' }, 400)

  const hashRow = db.select().from(settings).where(eq(settings.key, 'password_hash')).get()
  if (!hashRow) return c.json({ error: 'Not initialized' }, 503)

  const valid = await compare(body.password, hashRow.value)
  if (!valid) return c.json({ error: 'Invalid password' }, 401)

  const token = await signToken('Human', 'pwa')
  return c.json({ token })
})
