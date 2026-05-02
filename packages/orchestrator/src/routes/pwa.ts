import { Hono } from 'hono'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildMessagePath, buildReplyPath, CHAT_ROOT } from '@yeap/shared'
import { requireAuth } from '../middleware/auth.js'
import type { PwaSendPayload } from '@yeap/shared'

export const pwaRouter = new Hono()

pwaRouter.use('*', requireAuth)

pwaRouter.post('/send', async (c) => {
  const body = await c.req.json<PwaSendPayload>()
  if (!body.topic_id || !body.content) {
    return c.json({ error: 'topic_id and content are required' }, 400)
  }
  const topic_id = body.topic_id.toLowerCase()
  if (!/^[a-z0-9\-]{1,64}$/.test(topic_id)) {
    return c.json({ error: 'Invalid topic_id' }, 400)
  }

  const author = body.author_name ?? 'Human'

  if (body.parent_path) {
    const abs_parent = resolve(body.parent_path)
    if (!abs_parent.startsWith(CHAT_ROOT + '/')) {
      return c.json({ error: 'Invalid parent_path' }, 400)
    }
    const reply_path = buildReplyPath(abs_parent, author)
    mkdirSync(reply_path, { recursive: true })
    writeFileSync(join(reply_path, 'content.txt'), body.content, 'utf8')
    writeFileSync(join(reply_path, 'meta.json'), JSON.stringify({ type: 'text' }), 'utf8')
    return c.json({ path: reply_path.replace('/shared/', '') })
  }

  const msg_path = buildMessagePath(topic_id, author)
  mkdirSync(msg_path, { recursive: true })
  writeFileSync(join(msg_path, 'content.txt'), body.content, 'utf8')
  writeFileSync(join(msg_path, 'meta.json'), JSON.stringify({ type: 'text' }), 'utf8')
  return c.json({ path: msg_path.replace('/shared/', '') })
})
