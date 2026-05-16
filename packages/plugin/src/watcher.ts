/**
 * Mattermost watcher — polls subscribed channels and delivers new posts
 * into the bot's standing opencode session so the LLM actually responds.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] ?? 'http://orchestrator:3000'
const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'
const BOT_MODEL_RAW = process.env['BOT_MODEL'] ?? ''
const BOT_MODEL: { providerID: string; modelID: string } | null = (() => {
  if (!BOT_MODEL_RAW) return null
  const idx = BOT_MODEL_RAW.indexOf('/')
  if (idx === -1) return null
  return { providerID: BOT_MODEL_RAW.slice(0, idx), modelID: BOT_MODEL_RAW.slice(idx + 1) }
})()
const SKILLET_PATH = process.env['SKILLET_PATH'] ?? '/skillet'
const SESSION_FILE = join(SKILLET_PATH, 'session.json')
const LAST_SEEN_FILE = join(SKILLET_PATH, '.yeap-mm-last-seen.json')
const OPENCODE_URL = 'http://localhost:4096'
const POLL_INTERVAL_MS = 5_000

const MATTERMOST_URL = process.env['MATTERMOST_URL'] ?? 'http://mattermost:8065'
const MM_TOKEN = process.env['MATTERMOST_TOKEN'] ?? ''
const MM_USER_ID = process.env['MATTERMOST_USER_ID'] ?? ''
const MM_TEAM_ID = process.env['MATTERMOST_TEAM_ID'] ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

type MmPost = {
  id: string
  user_id: string
  channel_id: string
  message: string
  root_id: string
  create_at: number
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function loadLastSeen(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(LAST_SEEN_FILE, 'utf8')) as Record<string, number>
  } catch {
    return {}
  }
}

function saveLastSeen(data: Record<string, number>): void {
  writeFileSync(LAST_SEEN_FILE, JSON.stringify(data), 'utf8')
}

function loadSessionId(): string | null {
  try {
    const data = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as { session_id: string }
    return data.session_id ?? null
  } catch {
    return null
  }
}

// ─── Caches ───────────────────────────────────────────────────────────────────

const channelIdCache = new Map<string, string>()
const usernameCache = new Map<string, string>()

// ─── MM API helpers ───────────────────────────────────────────────────────────

async function mmGet(path: string): Promise<Response> {
  return fetch(`${MATTERMOST_URL}${path}`, {
    headers: { Authorization: `Bearer ${MM_TOKEN}` },
  })
}

async function getChannelId(topicId: string): Promise<string | null> {
  if (channelIdCache.has(topicId)) return channelIdCache.get(topicId)!
  if (!MM_TEAM_ID || !MM_TOKEN) return null
  try {
    const res = await mmGet(`/api/v4/teams/${MM_TEAM_ID}/channels/name/${encodeURIComponent(topicId)}`)
    if (!res.ok) return null
    const ch = (await res.json()) as { id: string }
    channelIdCache.set(topicId, ch.id)
    return ch.id
  } catch {
    return null
  }
}

async function fetchPostsSince(channelId: string, since: number): Promise<MmPost[]> {
  try {
    const res = await mmGet(`/api/v4/channels/${channelId}/posts?since=${since}`)
    if (!res.ok) return []
    const data = (await res.json()) as { order: string[]; posts: Record<string, MmPost> }
    return (data.order ?? []).map((id) => data.posts[id]).filter((p): p is MmPost => Boolean(p))
  } catch {
    return []
  }
}

async function getUsername(userId: string): Promise<string> {
  if (usernameCache.has(userId)) return usernameCache.get(userId)!
  try {
    const res = await mmGet(`/api/v4/users/${userId}`)
    if (!res.ok) return userId
    const user = (await res.json()) as { username: string }
    usernameCache.set(userId, user.username)
    return user.username
  } catch {
    return userId
  }
}

// ─── Orchestrator queries ─────────────────────────────────────────────────────

async function getSubscriptions(): Promise<string[]> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/registry/bots/${encodeURIComponent(BOT_NAME)}`)
    if (!res.ok) return []
    const data = (await res.json()) as { bot?: { subscriptions?: string[] } }
    return data.bot?.subscriptions ?? []
  } catch {
    return []
  }
}

async function compactCheck(): Promise<void> {
  try {
    await fetch(`${ORCHESTRATOR_URL}/spawn/compact-check/${encodeURIComponent(BOT_NAME)}`, { method: 'POST' })
  } catch {
    // non-critical
  }
}

async function requestSessionRecovery(): Promise<void> {
  try {
    await fetch(`${ORCHESTRATOR_URL}/spawn/compact/${encodeURIComponent(BOT_NAME)}`, { method: 'POST' })
  } catch {
    // non-critical
  }
}

// ─── Session delivery ─────────────────────────────────────────────────────────

function isOverflowError(err: unknown): boolean {
  const msg = String(err).toLowerCase()
  return msg.includes('too large') || msg.includes('context') || msg.includes('limit') || msg.includes('large')
}

async function deliverToSession(session_id: string, prompt: string): Promise<void> {
  const body: Record<string, unknown> = {
    parts: [{ type: 'text', text: prompt }],
  }
  if (BOT_MODEL) body['model'] = BOT_MODEL

  const res = await fetch(`${OPENCODE_URL}/session/${session_id}/prompt_async`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok && res.status !== 204) {
    const text = await res.text()
    throw new Error(`prompt_async failed ${res.status}: ${text}`)
  }
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(topic_id: string, post: MmPost, author: string, isReply: boolean): string {
  return [
    isReply ? '[YEAP INCOMING REPLY]' : '[YEAP INCOMING MESSAGE]',
    `Topic: ${topic_id}`,
    `From: ${author}`,
    `Post ID: ${post.id}`,
    `Channel ID: ${post.channel_id}`,
    ...(isReply ? [`In reply to post: ${post.root_id}`] : []),
    '',
    post.message,
    '',
    '---',
    'Only act on this message if it requires your direct input or action — do not reply just to acknowledge.',
    'If it is addressed directly to you (e.g. in your personal inbox), reply with substance.',
    'If it is informational or directed at others, take note but stay silent.',
    `Use reply_to_message(post_id="${post.root_id || post.id}", content="...") to reply in this thread,`,
    `or write_to_chat(topic_id="...", content="...") to start a new thread.`,
  ].join('\n')
}

// ─── Main poll loop ───────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  if (!MM_TOKEN || !MM_USER_ID) {
    console.log('[yeap-watcher] No MM credentials configured, skipping poll')
    return
  }

  const session_id = loadSessionId()
  if (!session_id) {
    console.log('[yeap-watcher] No session yet, skipping poll')
    return
  }

  const subscriptions = await getSubscriptions()
  if (!subscriptions.length) return

  const lastSeen = loadLastSeen()
  const now = Date.now()
  let dirty = false

  const pending: Array<{ topic_id: string; post: MmPost; author: string; isReply: boolean }> = []

  for (const topic_id of subscriptions) {
    const channelId = await getChannelId(topic_id)
    if (!channelId) continue

    const since = lastSeen[channelId] ?? (now - 30_000)
    const posts = await fetchPostsSince(channelId, since)

    // MM returns newest-first; sort chronologically for delivery order
    posts.sort((a, b) => a.create_at - b.create_at)

    let maxSeen = since
    for (const post of posts) {
      maxSeen = Math.max(maxSeen, post.create_at)
      if (post.user_id === MM_USER_ID) continue // skip own posts
      const author = await getUsername(post.user_id)
      pending.push({ topic_id, post, author, isReply: !!post.root_id })
    }

    if (posts.length > 0 || !lastSeen[channelId]) {
      lastSeen[channelId] = maxSeen + 1
      dirty = true
    }
  }

  if (dirty) saveLastSeen(lastSeen)

  // Deliver sequentially — don't flood the session
  for (const { topic_id, post, author, isReply } of pending) {
    console.log(`[yeap-watcher] Delivering post ${post.id} in #${topic_id} from ${author} to session ${session_id}`)
    try {
      await deliverToSession(session_id, buildPrompt(topic_id, post, author, isReply))
      void compactCheck()
      await new Promise<void>((r) => setTimeout(r, 500))
    } catch (err) {
      console.error('[yeap-watcher] Failed to deliver:', err)
      if (isOverflowError(err)) {
        console.warn('[yeap-watcher] Context overflow — requesting session recovery')
        void requestSessionRecovery()
      }
    }
  }
}

export function startWatcher(): void {
  console.log('[yeap-watcher] Starting Mattermost polling watcher (interval: 5s)')
  setTimeout(() => void poll(), 8_000)
  setInterval(() => void poll(), POLL_INTERVAL_MS)
}

