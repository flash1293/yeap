import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth.js'

export const pwaRouter = new Hono()

pwaRouter.use('*', requireAuth)

