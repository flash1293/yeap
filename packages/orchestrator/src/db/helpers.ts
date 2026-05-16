import { db } from '../db/index.js'
import { bots, subscriptions } from '../db/schema.js'
import { eq, inArray } from 'drizzle-orm'
import type { Bot } from '@yeap/shared'

/** Join a bots row with its subscriptions to produce a Bot object */
export function buildBot(
  row: typeof bots.$inferSelect,
  subs: string[],
): Bot {
  return {
    id: row.id,
    name: row.name,
    svg_icon: row.svg_icon,
    role_description: row.role_description,
    status: row.status,
    last_seen: row.last_seen ?? null,
    opencode_url: row.opencode_url ?? null,
    host_port: row.host_port ?? null,
    session_id: row.session_id ?? null,
    is_coordinator: row.is_coordinator,
    subscriptions: subs,
    messages_since_compact: row.messages_since_compact ?? 0,
    last_compact_at: row.last_compact_at ?? null,
    mattermost_user_id: row.mattermost_user_id ?? null,
  }
}

/** Fetch all bots, optionally filtering by topic and/or excluding a name */
export function queryBots(opts?: {
  topic?: string
  exclude?: string
}): Bot[] {
  const allBots = db.select().from(bots).all()

  const filtered = allBots.filter((b) => {
    if (opts?.exclude && b.name.toLowerCase() === opts.exclude.toLowerCase()) return false
    return true
  })

  if (!filtered.length) return []

  const botIds = filtered.map((b) => b.id)
  const allSubs = db
    .select()
    .from(subscriptions)
    .where(inArray(subscriptions.bot_id, botIds))
    .all()

  const subsByBot = new Map<string, string[]>()
  for (const sub of allSubs) {
    const list = subsByBot.get(sub.bot_id) ?? []
    list.push(sub.topic_id)
    subsByBot.set(sub.bot_id, list)
  }

  let result = filtered.map((b) => buildBot(b, subsByBot.get(b.id) ?? []))

  if (opts?.topic) {
    result = result.filter((b) => b.subscriptions.includes(opts.topic!))
  }

  return result
}

/** Fetch a single bot by name */
export function getBotByName(name: string): Bot | null {
  const row = db.select().from(bots).where(eq(bots.name, name)).get()
  if (!row) return null
  const subs = db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.bot_id, row.id))
    .all()
  return buildBot(row, subs.map((s) => s.topic_id))
}
