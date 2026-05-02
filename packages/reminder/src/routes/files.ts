import { Hono } from 'hono'
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { SHARED_ROOT, CHAT_ROOT, DOCS_ROOT } from '@yeap/shared'
import type { FileNode } from '@yeap/shared'

export const filesRouter = new Hono()

filesRouter.get('/', (c) => {
  const raw = c.req.query('path')
  if (!raw) return c.json({ error: 'path query param required' }, 400)

  const err = validatePath(raw)
  if (err) return c.json({ error: err }, 400)

  if (!existsSync(raw)) return c.json({ error: 'Not found' }, 404)

  const entries = readdirSync(raw)
  const nodes: FileNode[] = entries.map((name) => {
    const full = join(raw, name)
    const st = statSync(full)
    return {
      name,
      path: full,
      is_dir: st.isDirectory(),
      modified_at: st.mtimeMs,
    }
  })

  return c.json(nodes)
})

filesRouter.get('/content', (c) => {
  const raw = c.req.query('path')
  if (!raw) return c.json({ error: 'path query param required' }, 400)

  const err = validatePath(raw)
  if (err) return c.json({ error: err }, 400)

  // Only allow reads from chat and docs directories
  const normalised = raw.replace(/\\/g, '/')
  const chatRoot = CHAT_ROOT.replace(/\\/g, '/')
  const docsRoot = DOCS_ROOT.replace(/\\/g, '/')
  if (!normalised.startsWith(chatRoot) && !normalised.startsWith(docsRoot)) {
    return c.json({ error: 'Access denied' }, 403)
  }

  if (!existsSync(raw)) return c.json({ error: 'Not found' }, 404)

  const content = readFileSync(raw, 'utf8')
  return c.json({ content })
})

function validatePath(raw: string): string | null {
  if (raw.includes('..')) return 'Path must not contain ..'
  const normalised = raw.replace(/\\/g, '/')
  const sharedRoot = SHARED_ROOT.replace(/\\/g, '/')
  if (!normalised.startsWith(sharedRoot)) return 'Path must be within /shared'
  return null
}
