import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { and, isNotNull, lte, or, eq } from 'drizzle-orm'
// @ts-ignore — cron-parser has no bundled types in v4
import cronParser from 'cron-parser'

const DB_PATH = process.env['REMINDER_DB_PATH'] ?? '/data/reminders.db'
const TICK_MS = parseInt(process.env['SCHEDULER_TICK_MS'] ?? '10000', 10)
const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] ?? 'http://orchestrator:3000'

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
  /** Shell script; if set, only fire when exit code != 0 */
  script: text('script'),
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

// Incremental migrations
try { sqlite.exec('ALTER TABLE reminders ADD COLUMN script TEXT') } catch { /* already exists */ }

export const db = drizzle(sqlite, { schema: { reminders } })

// ── Tick ──────────────────────────────────────────────────────────────────────

export function startScheduler(): void {
  setInterval(() => { void tick() }, TICK_MS)
  console.log(`[scheduler] Running with ${TICK_MS}ms tick`)
}

async function tick(): Promise<void> {
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
    // Advance or delete before firing so concurrent ticks don't double-fire.
    if (reminder.cron) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        const next = (cronParser.parseExpression(reminder.cron).next() as { getTime(): number }).getTime()
        db.update(reminders).set({ next_fire_at: next }).where(eq(reminders.id, reminder.id)).run()
      } catch (err) {
        console.error(`[scheduler] Failed to advance cron for ${reminder.id}:`, err)
        continue
      }
    } else {
      db.delete(reminders).where(eq(reminders.id, reminder.id)).run()
    }

    try {
      await fireReminder(reminder)
    } catch (err) {
      console.error(`[scheduler] Failed to fire reminder ${reminder.id}:`, err)
    }
  }
}

async function fireReminder(reminder: ReminderRow): Promise<void> {
  let content = reminder.content

  // Scripted reminder: run the script; only fire message if exit code != 0
  if (reminder.script) {
    let exit_code: number
    let scriptOutput: string
    try {
      const res = await fetch(
        `${ORCHESTRATOR_URL}/spawn/exec/${encodeURIComponent(reminder.bot_name)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ script: reminder.script, timeout_ms: 30_000 }),
        },
      )
      if (!res.ok) {
        console.error(`[scheduler] exec endpoint returned ${res.status} for reminder ${reminder.id}`)
        return
      }
      const result = (await res.json()) as { exit_code: number; stdout: string; stderr: string }
      exit_code = result.exit_code
      scriptOutput = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    } catch (err) {
      console.error(`[scheduler] Failed to run script for reminder ${reminder.id}:`, err)
      return
    }

    if (exit_code === 0) {
      console.log(`[scheduler] Scripted reminder ${reminder.id} — script exited 0, skipping`)
      return
    }

    if (scriptOutput) {
      content = `${content}\n\n---\nScript output:\n\`\`\`\n${scriptOutput}\n\`\`\``
    }
    console.log(`[scheduler] Scripted reminder ${reminder.id} — script exited non-zero, firing`)
  }

  // Post to Mattermost via orchestrator's internal notify endpoint
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/internal/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel_name: reminder.topic_id,
        content,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      let errMsg: string
      try { errMsg = (JSON.parse(text) as { error?: string }).error ?? text } catch { errMsg = text }
      console.error(`[scheduler] notify failed for reminder ${reminder.id}: ${errMsg}`)
    } else {
      console.log(`[scheduler] Fired reminder ${reminder.id} → #${reminder.topic_id}`)
    }
  } catch (err) {
    console.error(`[scheduler] Failed to post reminder ${reminder.id}:`, err)
  }
}

