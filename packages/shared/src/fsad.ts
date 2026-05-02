import { join } from 'node:path'

export const SHARED_ROOT = process.env['SHARED_ROOT'] ?? '/shared'
export const CHAT_ROOT = join(SHARED_ROOT, 'chat')
export const WORK_ROOT = join(SHARED_ROOT, 'work')
export const DOCS_ROOT = join(SHARED_ROOT, 'yeap-docs')

/**
 * Format a UTC timestamp string suitable for use in FSAD directory names.
 * Format: YYYYMMDDTHHmmss.SSS  (sortable, zero-padded)
 */
export function formatTimestamp(date: Date = new Date()): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}` +
    `.${pad(date.getUTCMilliseconds(), 3)}`
  )
}

/**
 * Parse a message directory base name into timestamp + author.
 * Expected format: "YYYYMMDDTHHmmss.SSS_AuthorName"
 */
export function parseMessageDirName(
  dirName: string,
): { timestamp: string; author_name: string } | null {
  const idx = dirName.indexOf('_')
  if (idx === -1) return null
  const timestamp = dirName.slice(0, idx)
  const author_name = dirName.slice(idx + 1)
  if (!timestamp || !author_name) return null
  return { timestamp, author_name }
}

/**
 * Build an absolute path for a new top-level message directory.
 */
export function buildMessagePath(
  topic_id: string,
  author_name: string,
  date?: Date,
): string {
  return join(CHAT_ROOT, topic_id, `${formatTimestamp(date)}_${author_name}`)
}

/**
 * Build a reply path nested inside a parent message directory.
 */
export function buildReplyPath(
  parent_path: string,
  author_name: string,
  date?: Date,
): string {
  return join(parent_path, `${formatTimestamp(date)}_${author_name}`)
}

/**
 * Derive topic_id, author_name and timestamp from an absolute message dir path.
 * Returns null if the path is not a valid message directory (e.g. the topic dir itself).
 */
export function parseMessagePath(
  abs_path: string,
): { topic_id: string; author_name: string; timestamp: string } | null {
  const normalised = abs_path.replace(/\\/g, '/')
  const root = CHAT_ROOT.replace(/\\/g, '/')
  if (!normalised.startsWith(root + '/')) return null

  const rel = normalised.slice(root.length + 1)
  const parts = rel.split('/')
  // parts[0] = topic_id, parts[1] = TS_AUTHOR (first-level message)
  if (parts.length < 2) return null
  const msgDir = parts[1]
  if (!msgDir) return null
  const parsed = parseMessageDirName(msgDir)
  if (!parsed) return null
  return { topic_id: parts[0] ?? '', ...parsed }
}
