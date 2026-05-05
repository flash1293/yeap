/**
 * Filesystem watcher — polls subscribed FSAD topics and delivers new messages
 * into the bot's standing opencode session so the LLM actually responds.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CHAT_ROOT, parseMessageDirName } from '@yeap/shared'

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
const SEEN_FILE = join(SKILLET_PATH, '.yeap-seen.json')
const OPENCODE_URL = 'http://localhost:4096'
const POLL_INTERVAL_MS = 5_000

// ─── Persistence ─────────────────────────────────────────────────────────────

type SeenSet = Record<string, true>

function loadSeen(): SeenSet {
  try {
    return JSON.parse(readFileSync(SEEN_FILE, 'utf8')) as SeenSet
  } catch {
    return {}
  }
}

function saveSeen(seen: SeenSet): void {
  writeFileSync(SEEN_FILE, JSON.stringify(seen), 'utf8')
}

function loadSessionId(): string | null {
  try {
    const data = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as { session_id: string }
    return data.session_id ?? null
  } catch {
    return null
  }
}

// ─── Orchestrator queries ─────────────────────────────────────────────────────

async function getSubscriptions(): Promise<string[]> {
  try {
    const res = await fetch(
      `${ORCHESTRATOR_URL}/registry/bots/${encodeURIComponent(BOT_NAME)}`,
    )
    if (!res.ok) return []
    const data = (await res.json()) as { bot?: { subscriptions?: string[] } }
    return data.bot?.subscriptions ?? []
  } catch {
    return []
  }
}

/** Return names of other bots also subscribed to a topic (excludes self). */
async function getTopicCosubscribers(topic_id: string): Promise<string[]> {
  try {
    const url = new URL(`${ORCHESTRATOR_URL}/registry/bots`)
    url.searchParams.set('topic', topic_id)
    url.searchParams.set('exclude', BOT_NAME)
    const res = await fetch(url)
    if (!res.ok) return []
    const bots = (await res.json()) as Array<{ name: string }>
    return bots.map((b) => b.name)
  } catch {
    return []
  }
}

// ─── Message delivery ─────────────────────────────────────────────────────────

async function compactCheck(): Promise<void> {
  try {
    await fetch(`${ORCHESTRATOR_URL}/spawn/compact-check/${encodeURIComponent(BOT_NAME)}`, { method: 'POST' })
  } catch {
    // non-critical
  }
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
    const body = await res.text()
    throw new Error(`prompt_async failed ${res.status}: ${body}`)
  }
}

function buildPrompt(
  topic_id: string,
  msgDir: string,
  author: string,
  content: string,
  msgType: string,
  otherNotified: string[],
): string {
  const topicDir = `${CHAT_ROOT}/${topic_id}`
  return [
    `[YEAP INCOMING MESSAGE]`,
    `Topic: ${topic_id}`,
    `From: ${author}`,
    `Type: ${msgType}`,
    `Message path: ${msgDir}`,
    `Also notified: ${
      otherNotified.length > 0 ? otherNotified.join(', ') : '(only you)'
    }`,
    ``,
    content,
    ``,
    `---`,
    `Only act on this message if it requires your direct input or action — do not reply just to acknowledge.`,
    `If it is addressed directly to you (e.g. in your personal inbox), reply with substance.`,
    `If it is informational or directed at others, take note but stay silent.`,
    `Use reply_to_message(parent_path="${msgDir}", content="...") to reply,`,
    `or write_to_chat(topic_id="...", content="...") to start a new thread.`,
    ``,
    `Filesystem context (read surrounding messages without extra API calls):`,
    `  This message       : cat ${msgDir}/content.txt`,
    `  All messages (sorted): ls ${topicDir}/ | sort`,
    `  Replies to this    : ls ${msgDir}/`,
  ].join('\n')
}

function buildReplyPrompt(
  topic_id: string,
  replyDir: string,
  parentDir: string,
  author: string,
  content: string,
  msgType: string,
  otherNotified: string[],
): string {
  const topicDir = `${CHAT_ROOT}/${topic_id}`
  return [
    `[YEAP INCOMING REPLY]`,
    `Topic: ${topic_id}`,
    `From: ${author}`,
    `Type: ${msgType}`,
    `Reply path: ${replyDir}`,
    `In reply to: ${parentDir}`,
    `Also notified: ${
      otherNotified.length > 0 ? otherNotified.join(', ') : '(only you)'
    }`,
    ``,
    content,
    ``,
    `---`,
    `Only continue this thread if you have something meaningful to add or are being asked to act.`,
    `Do not reply just to acknowledge — silence is fine if no action is needed.`,
    `Use reply_to_message(parent_path="${replyDir}", content="...") to continue this thread,`,
    `or reply_to_message(parent_path="${parentDir}", content="...") to reply at the original level.`,
    ``,
    `Filesystem context (read surrounding messages without extra API calls):`,
    `  This reply         : cat ${replyDir}/content.txt`,
    `  Parent message     : cat ${parentDir}/content.txt`,
    `  All replies        : ls ${parentDir}/`,
    `  All messages (sorted): ls ${topicDir}/ | sort`,
  ].join('\n')
}

// ─── Main poll loop ───────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  const session_id = loadSessionId()
  if (!session_id) {
    console.log('[yeap-watcher] No session yet, skipping poll')
    return
  }

  const subscriptions = await getSubscriptions()
  if (!subscriptions.length) return

  // Fetch co-subscribers for each topic once (not per message)
  const cosubsCache = new Map<string, string[]>()
  await Promise.all(
    subscriptions.map(async (topic_id) => {
      cosubsCache.set(topic_id, await getTopicCosubscribers(topic_id))
    }),
  )

  const seen = loadSeen()
  let dirty = false

  const pending: Array<{ topic_id: string; msgDir: string; prompt: string }> = []

  for (const topic_id of subscriptions) {
    const topicDir = join(CHAT_ROOT, topic_id)
    if (!existsSync(topicDir)) continue

    let entries: string[]
    try {
      entries = readdirSync(topicDir).sort() // chronological order
    } catch {
      continue
    }

    for (const entry of entries) {
      const key = `${topic_id}/${entry}`
      const msgDir = join(topicDir, entry)

      // Determine whether this entry is a directory (skip plain files)
      let isDir = false
      try {
        isDir = statSync(msgDir).isDirectory()
      } catch {
        continue
      }

      if (!isDir) {
        if (!seen[key]) { seen[key] = true; dirty = true }
        continue
      }

      // ── Process top-level message (only once) ────────────────────────────
      if (!seen[key]) {
        seen[key] = true
        dirty = true

        const parsed = parseMessageDirName(entry)
        if (parsed && parsed.author_name.toLowerCase() !== BOT_NAME.toLowerCase()) {
          const contentFile = join(msgDir, 'content.txt')
          const metaFile = join(msgDir, 'meta.json')
          if (existsSync(contentFile)) {
            const content = readFileSync(contentFile, 'utf8').trim()
            if (content) {
              let msgType = 'text'
              try {
                const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as { type?: string }
                msgType = meta.type ?? 'text'
              } catch {
                // no meta, use default
              }
              const cosubsExAuthor = (cosubsCache.get(topic_id) ?? []).filter(
                (n) => n.toLowerCase() !== parsed.author_name.toLowerCase(),
              )
              pending.push({
                topic_id,
                msgDir,
                prompt: buildPrompt(topic_id, msgDir, parsed.author_name, content, msgType, cosubsExAuthor),
              })
            }
          }
        }
      }

      // ── Scan for new replies inside this message directory ────────────────
      // We always check, even for already-seen top-level messages, because
      // replies can arrive after the parent was first processed.
      let replyEntries: string[]
      try {
        replyEntries = readdirSync(msgDir).sort()
      } catch {
        continue
      }

      for (const replyEntry of replyEntries) {
        const replyKey = `${topic_id}/${entry}/${replyEntry}`
        if (seen[replyKey]) continue

        const replyDir = join(msgDir, replyEntry)
        try {
          if (!statSync(replyDir).isDirectory()) {
            seen[replyKey] = true
            dirty = true
            continue
          }
        } catch {
          continue
        }

        seen[replyKey] = true
        dirty = true

        const parsed = parseMessageDirName(replyEntry)
        if (!parsed) continue
        if (parsed.author_name.toLowerCase() === BOT_NAME.toLowerCase()) continue

        const contentFile = join(replyDir, 'content.txt')
        const metaFile = join(replyDir, 'meta.json')
        if (!existsSync(contentFile)) continue

        const content = readFileSync(contentFile, 'utf8').trim()
        if (!content) continue

        let msgType = 'text'
        try {
          const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as { type?: string }
          msgType = meta.type ?? 'text'
        } catch {
          // no meta, use default
        }

        const cosubsExAuthor = (cosubsCache.get(topic_id) ?? []).filter(
          (n) => n.toLowerCase() !== parsed.author_name.toLowerCase(),
        )
        pending.push({
          topic_id,
          msgDir: replyDir,
          prompt: buildReplyPrompt(topic_id, replyDir, msgDir, parsed.author_name, content, msgType, cosubsExAuthor),
        })
      }
    }
  }

  if (dirty) saveSeen(seen)

  // Deliver sequentially — don't flood the session
  for (const { topic_id, msgDir, prompt } of pending) {
    console.log(
      `[yeap-watcher] Delivering message in topic '${topic_id}' (${msgDir.split('/').pop()}) to session ${session_id}`,
    )
    try {
      await deliverToSession(session_id, prompt)
      void compactCheck()
      // Small gap between deliveries
      await new Promise<void>((r) => setTimeout(r, 500))
    } catch (err) {
      console.error(`[yeap-watcher] Failed to deliver:`, err)
    }
  }
}

export function startWatcher(): void {
  console.log('[yeap-watcher] Starting polling watcher (interval: 5s)')
  // First poll after initial delay to let session settle
  setTimeout(() => void poll(), 8_000)
  setInterval(() => void poll(), POLL_INTERVAL_MS)
}
