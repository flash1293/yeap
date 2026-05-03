import { fetchTopicPage as fetchTopicPageAPI } from '../api/reminder.js'
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

export async function loadTopicPage(
  topic_id: string,
  limit: number,
): Promise<{ messages: FsadMessage[]; total: number }> {
  return fetchTopicPageAPI(topic_id, limit)
}

export async function loadTopics(): Promise<string[]> {
  const entries = await listFiles(CHAT_ROOT)
  return entries.filter((e) => e.is_dir).map((e) => e.name)
}

