import chokidar from 'chokidar'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { CHAT_ROOT, parseMessagePath } from '@yeap/shared'
import type { FsadEvent, MessageMeta } from '@yeap/shared'
import { ssebus } from './sse.js'

export function startWatcher(): void {
  const depth = parseInt(process.env['CHOKIDAR_DEPTH'] ?? '4', 10)

  const watcher = chokidar.watch(CHAT_ROOT, {
    depth,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 150,
      pollInterval: 50,
    },
    ignored: /(^|[/\\])\../,
  })

  watcher.on('addDir', async (abs_path) => {
    try {
      await handleNewDir(abs_path)
    } catch (err) {
      console.error('[watcher] Error handling new dir:', abs_path, err)
    }
  })

  watcher.on('error', (err) => {
    console.error('[watcher] chokidar error:', err)
  })

  console.log(`[watcher] Watching ${CHAT_ROOT}`)
}

async function handleNewDir(abs_path: string): Promise<void> {
  const parsed = parseMessagePath(abs_path)
  if (!parsed) return // topic dir itself or unrecognised

  const content_path = join(abs_path, 'content.txt')
  if (!existsSync(content_path)) return

  const content = readFileSync(content_path, 'utf8')
  const meta = readMeta(abs_path)

  // Determine if reply: more than 2 path segments below CHAT_ROOT
  const rel = abs_path.replace(CHAT_ROOT.replace(/\\/g, '/'), '').replace(/\\/g, '/')
  const segments = rel.split('/').filter(Boolean)
  const is_reply = segments.length > 2
  const parent_path = join(abs_path, '..')  // always string; only included in new_reply events

  const event: FsadEvent =
    is_reply
      ? {
          type: 'new_reply',
          topic_id: parsed.topic_id,
          author_name: parsed.author_name,
          timestamp: parsed.timestamp,
          message_path: abs_path,
          parent_path,
          content,
          meta,
        }
      : {
          type: 'new_message',
          topic_id: parsed.topic_id,
          author_name: parsed.author_name,
          timestamp: parsed.timestamp,
          message_path: abs_path,
          content,
          meta,
        }

  ssebus.broadcast(event)
}

function readMeta(dir: string): MessageMeta | null {
  const meta_path = join(dir, 'meta.json')
  if (!existsSync(meta_path)) return null
  try {
    return JSON.parse(readFileSync(meta_path, 'utf8')) as MessageMeta
  } catch {
    return null
  }
}
