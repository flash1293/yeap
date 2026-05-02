import type { Bot, FsadEvent, MessageMeta } from '@yeap/shared'

const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] ?? 'http://orchestrator:3000'

export async function deliverToSubscribers(event: FsadEvent): Promise<void> {
  if (event.type === 'connected') return

  const url = new URL(`${ORCHESTRATOR_URL}/registry/bots`)
  // Normalize topic_id to lowercase — bot subscriptions are always lowercase
  url.searchParams.set('topic', event.topic_id.toLowerCase())
  url.searchParams.set('exclude', event.author_name)

  let bots: Bot[]
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Registry responded ${res.status}`)
    bots = (await res.json()) as Bot[]
  } catch (err) {
    console.error('[deliver] Failed to fetch subscribers:', err)
    return
  }

  await Promise.allSettled(bots.map((bot) => deliverToBot(bot, event)))
}

async function deliverToBot(bot: Bot, event: FsadEvent): Promise<void> {
  if (event.type === 'connected') return
  if (!bot.opencode_url || !bot.session_id) {
    console.warn(`[deliver] Bot ${bot.name} has no opencode_url/session_id — skipping`)
    return
  }

  const text = formatMessageForBot(event)
  const endpoint = `${bot.opencode_url}/session/${bot.session_id}/message`

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parts: [{ type: 'text', text }],
      }),
    })
    if (!res.ok) {
      console.error(`[deliver] OpenCode returned ${res.status} for bot ${bot.name}`)
    }
  } catch (err) {
    console.error(`[deliver] Failed to deliver to ${bot.name}:`, err)
  }
}

function formatMessageForBot(event: Extract<FsadEvent, { type: 'new_message' | 'new_reply' }>): string {
  const lines: string[] = [
    `[YEAP MESSAGE]`,
    `Topic: ${event.topic_id}`,
    `From: ${event.author_name}`,
    `Time: ${event.timestamp}`,
    `Path: ${event.message_path}`,
  ]
  if (event.type === 'new_reply' && event.parent_path) {
    lines.push(`Reply to: ${event.parent_path}`)
  }
  lines.push('', event.content)
  return lines.join('\n')
}
