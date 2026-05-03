import { Hono } from 'hono'
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { SHARED_ROOT, CHAT_ROOT, DOCS_ROOT, parseMessageDirName } from '@yeap/shared'
import type { FileNode, FsadMessage, MessageMeta } from '@yeap/shared'

export const filesRouter = new Hono()

// ─── Topic bulk loader ────────────────────────────────────────────────────────
// GET /files/topic?topic_id=<id>&limit=<n>
// Returns { messages: FsadMessage[], total: number } in a single round-trip.
filesRouter.get('/topic', (c) => {
  const topic_id = c.req.query('topic_id')
  const limit = parseInt(c.req.query('limit') ?? '20', 10)

  if (!topic_id || !/^[a-z0-9-]{1,64}$/.test(topic_id)) {
    return c.json({ error: 'Invalid topic_id' }, 400)
  }

  const topic_path = join(CHAT_ROOT, topic_id)
  if (!existsSync(topic_path)) return c.json({ messages: [], total: 0 })

  let dirs: string[]
  try {
    dirs = readdirSync(topic_path)
      .filter((n) => {
        try { return statSync(join(topic_path, n)).isDirectory() } catch { return false }
      })
      .sort()
  } catch {
    return c.json({ messages: [], total: 0 })
  }

  const total = dirs.length
  const slice = dirs.slice(Math.max(0, total - limit))
  const messages = slice.map((d) => readMessageDir(join(topic_path, d), topic_id))

  return c.json({ messages, total })
})

function readMessageDir(abs_path: string, topic_id: string): FsadMessage {
  const dir_name = abs_path.split('/').pop() ?? ''
  const parsed = parseMessageDirName(dir_name)

  let content = ''
  try { content = readFileSync(join(abs_path, 'content.txt'), 'utf8') } catch { /* absent */ }

  let meta: MessageMeta | null = null
  try { meta = JSON.parse(readFileSync(join(abs_path, 'meta.json'), 'utf8')) as MessageMeta } catch { /* absent */ }

  let replies: FsadMessage[] = []
  try {
    replies = readdirSync(abs_path)
      .filter((n) => {
        try { return statSync(join(abs_path, n)).isDirectory() } catch { return false }
      })
      .sort()
      .map((r) => readMessageDir(join(abs_path, r), topic_id))
  } catch { /* absent */ }

  return {
    topic_id,
    author_name: parsed?.author_name ?? 'Unknown',
    timestamp: parsed?.timestamp ?? '',
    path: abs_path,
    relative_path: abs_path.replace('/shared/', ''),
    content,
    meta,
    replies,
  }
}

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
