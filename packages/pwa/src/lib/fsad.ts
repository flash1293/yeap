import { listFiles, getFileContent } from '../api/reminder.js'
import type { FsadMessage, MessageMeta } from '@yeap/shared'

// Inline the server-side path constants — @yeap/shared/fsad uses node:path
// which Vite cannot bundle for the browser.
const CHAT_ROOT = '/shared/chat'

function parseMessageDirName(dirName: string): { timestamp: string; author_name: string } | null {
  const idx = dirName.indexOf('_')
  if (idx === -1) return null
  return { timestamp: dirName.slice(0, idx), author_name: dirName.slice(idx + 1) }
}

export async function loadTopic(topic_id: string): Promise<FsadMessage[]> {
  const topic_path = `${CHAT_ROOT}/${topic_id}`
  const entries = await listFiles(topic_path)
  const dirs = entries
    .filter((e) => e.is_dir)
    .sort((a, b) => a.name.localeCompare(b.name))

  return Promise.all(dirs.map((d) => loadMessage(d.path, topic_id)))
}

export async function loadTopics(): Promise<string[]> {
  const entries = await listFiles(CHAT_ROOT)
  return entries.filter((e) => e.is_dir).map((e) => e.name)
}

async function loadMessage(abs_path: string, topic_id: string): Promise<FsadMessage> {
  const dir_name = abs_path.split('/').pop() ?? ''
  const parsed = parseMessageDirName(dir_name)
  const author_name = parsed?.author_name ?? 'Unknown'
  const timestamp = parsed?.timestamp ?? ''

  let content = ''
  try {
    content = await getFileContent(`${abs_path}/content.txt`)
  } catch {
    content = ''
  }

  let meta: MessageMeta | null = null
  try {
    const raw = await getFileContent(`${abs_path}/meta.json`)
    meta = JSON.parse(raw) as MessageMeta
  } catch {
    // absent
  }

  const children = await listFiles(abs_path)
  const reply_dirs = children.filter((c) => c.is_dir).sort((a, b) => a.name.localeCompare(b.name))
  const replies = await Promise.all(reply_dirs.map((r) => loadMessage(r.path, topic_id)))

  return {
    topic_id,
    author_name,
    timestamp,
    path: abs_path,
    relative_path: abs_path.replace('/shared/', ''),
    content,
    meta,
    replies,
  }
}
