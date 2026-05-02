import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { and, isNotNull, lte, or, eq } from 'drizzle-orm'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildMessagePath } from '@yeap/shared'
// @ts-ignore — cron-parser has no bundled types in v4
import cronParser from 'cron-parser'

const DB_PATH = process.env['REMINDER_DB_PATH'] ?? '/data/reminders.db'
const TICK_MS = parseInt(process.env['SCHEDULER_TICK_MS'] ?? '10000', 10)

// ── Schema ────────────────────────────────────────────────────────────────────

export const reminders = sqliteTable('reminders', {
  id: text('id').primaryKey(),
  bot_name: text('bot_name').notNull(),
  topic_id: text('topic_id').notNull(),
  content: text('content').notNull(),
  fire_at: integer('fire_at'),
  cron: text('cron'),
  next_fire_at: integer('next_fire_at'),
  created_at: integer('created_at').notNull(),
  author_mode: text('author_mode').notNull().default('Reminder'),
  meta_type: text('meta_type').notNull().default('alert'),
})

export type ReminderRow = typeof reminders.$inferSelect

// ── DB init ───────────────────────────────────────────────────────────────────

const sqlite = new Database(DB_PATH)
sqlite.pragma('journal_mode = WAL')

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    bot_name TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    content TEXT NOT NULL,
    fire_at INTEGER,
    cron TEXT,
    next_fire_at INTEGER,
    created_at INTEGER NOT NULL,
    author_mode TEXT NOT NULL DEFAULT 'Reminder',
    meta_type TEXT NOT NULL DEFAULT 'alert'
  );
`)

export const db = drizzle(sqlite, { schema: { reminders } })

// ── Tick ──────────────────────────────────────────────────────────────────────

export function startScheduler(): void {
  setInterval(tick, TICK_MS)
  console.log(`[scheduler] Running with ${TICK_MS}ms tick`)
}

function tick(): void {
  const now = Date.now()

  const due = db
    .select()
    .from(reminders)
    .where(
      or(
        and(isNotNull(reminders.fire_at), lte(reminders.fire_at, now)),
        and(isNotNull(reminders.cron), isNotNull(reminders.next_fire_at), lte(reminders.next_fire_at, now)),
      ),
    )
    .all()

  for (const reminder of due) {
    try {
      fireReminder(reminder)
    } catch (err) {
      console.error(`[scheduler] Failed to fire reminder ${reminder.id}:`, err)
    }

    if (reminder.cron) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        const next = (cronParser.parseExpression(reminder.cron).next() as { getTime(): number }).getTime()
        db.update(reminders).set({ next_fire_at: next }).where(eq(reminders.id, reminder.id)).run()
      } catch (err) {
        console.error(`[scheduler] Failed to advance cron for ${reminder.id}:`, err)
      }
    } else {
      db.delete(reminders).where(eq(reminders.id, reminder.id)).run()
    }
  }
}

function fireReminder(reminder: ReminderRow): void {
  const author = reminder.author_mode === 'bot' ? reminder.bot_name : 'Reminder'
  const msg_path = buildMessagePath(reminder.topic_id, author)

  mkdirSync(msg_path, { recursive: true })
  writeFileSync(join(msg_path, 'content.txt'), reminder.content, 'utf8')
  writeFileSync(
    join(msg_path, 'meta.json'),
    JSON.stringify({ type: reminder.meta_type, reminder_id: reminder.id }),
    'utf8',
  )
  console.log(`[scheduler] Fired reminder ${reminder.id} → ${msg_path}`)
}
