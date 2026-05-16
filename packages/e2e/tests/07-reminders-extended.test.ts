/**
 * 07-reminders-extended.test.ts
 *
 * Extended reminder coverage:
 *  - delay_ms one-shot
 *  - cron (every minute) — fires within 75s
 *  - scripted (exit 1)  — fires message with output appended
 *  - scripted (exit 0)  — suppressed (no message delivered)
 */
import { afterAll, describe, expect, it } from 'vitest'
import { REMINDER_URL, ORCHESTRATOR_URL, MATTERMOST_URL, getChannelId, waitForPost, sleep } from './helpers.js'
import type { Reminder } from '@yeap/shared'

const COORDINATOR_BOT = process.env['COORDINATOR_NAME'] ?? 'Coordinator'
const CREATED_IDS: string[] = []

async function createReminder(payload: Record<string, unknown>): Promise<Reminder> {
  const res = await fetch(`${REMINDER_URL}/reminders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  expect(res.status, `Expected 201, got ${res.status}`).toBe(201)
  const r = (await res.json()) as Reminder
  CREATED_IDS.push(r.id)
  return r
}

afterAll(async () => {
  // Clean up any reminders left over (e.g. the cron one)
  for (const id of CREATED_IDS) {
    await fetch(`${REMINDER_URL}/reminders/${id}`, { method: 'DELETE' }).catch(() => undefined)
  }
})

// ── 1. delay_ms ───────────────────────────────────────────────────────────────

describe('Reminders — delay_ms one-shot', () => {
  it('fires after the given delay and is removed from the list', async () => {
    const channelId = await getChannelId('human')
    const marker = `delay-ms-e2e-${Date.now()}`
    const startMs = Date.now()

    const reminder = await createReminder({
      bot_name: COORDINATOR_BOT,
      topic_id: 'human',
      content: marker,
      delay_ms: 15_000,
      meta_type: 'alert',
    })

    // Should appear in list
    const listRes = await fetch(`${REMINDER_URL}/reminders?bot_name=${encodeURIComponent(COORDINATOR_BOT)}`)
    const list = (await listRes.json()) as Reminder[]
    expect(list.some((r) => r.id === reminder.id)).toBe(true)

    // Should fire within 45s
    const post = await waitForPost(channelId, {
      containsText: marker,
      timeoutMs: 45_000,
      afterMs: startMs,
    })
    expect(post.message).toContain(marker)

    // Should be deleted after firing
    await sleep(2_000)
    const listRes2 = await fetch(`${REMINDER_URL}/reminders?bot_name=${encodeURIComponent(COORDINATOR_BOT)}`)
    const list2 = (await listRes2.json()) as Reminder[]
    expect(list2.some((r) => r.id === reminder.id)).toBe(false)
  })
})

// ── 2. cron ───────────────────────────────────────────────────────────────────

describe('Reminders — cron (recurring)', () => {
  let cronReminderId: string

  it('cron reminder fires at least once per minute and stays in list', async () => {
    const channelId = await getChannelId('human')
    const marker = `cron-e2e-${Date.now()}`
    const startMs = Date.now()

    const reminder = await createReminder({
      bot_name: COORDINATOR_BOT,
      topic_id: 'human',
      content: marker,
      cron: '* * * * *', // every minute
      meta_type: 'alert',
    })
    cronReminderId = reminder.id

    // Should appear in list
    const listRes = await fetch(`${REMINDER_URL}/reminders?bot_name=${encodeURIComponent(COORDINATOR_BOT)}`)
    const list = (await listRes.json()) as Reminder[]
    const found = list.find((r) => r.id === reminder.id)
    expect(found).toBeDefined()
    expect(found!.cron).toBe('* * * * *')
    expect(found!.next_fire_at).toBeGreaterThan(startMs)

    // Wait for the first firing (up to 75s to account for sub-minute wait)
    const post = await waitForPost(channelId, {
      containsText: marker,
      timeoutMs: 75_000,
      afterMs: startMs,
    })
    expect(post.message).toContain(marker)

    // Should still be in list (recurring)
    await sleep(2_000)
    const listRes2 = await fetch(`${REMINDER_URL}/reminders?bot_name=${encodeURIComponent(COORDINATOR_BOT)}`)
    const list2 = (await listRes2.json()) as Reminder[]
    const found2 = list2.find((r) => r.id === reminder.id)
    expect(found2, 'Cron reminder should remain in list after firing').toBeDefined()

    // next_fire_at should have advanced
    expect(found2!.next_fire_at).toBeGreaterThan(found!.next_fire_at!)
  })

  afterAll(async () => {
    if (cronReminderId) {
      await fetch(`${REMINDER_URL}/reminders/${cronReminderId}`, { method: 'DELETE' }).catch(() => undefined)
    }
  })
})

// ── 3. scripted reminder — exits non-zero → fires ────────────────────────────

describe('Reminders — scripted (exit non-zero fires message)', () => {
  it('fires the message with script output appended when script exits non-zero', async () => {
    // The coordinator container must be online for exec to work.
    // Verify it is before creating the reminder.
    const healthRes = await fetch(`${ORCHESTRATOR_URL}/registry/bots`)
    expect(healthRes.status).toBe(200)
    const bots = (await healthRes.json()) as Array<{ name: string; status: string }>
    const coord = bots.find((b) => b.name === COORDINATOR_BOT)
    expect(coord?.status, 'Coordinator must be online for scripted reminder exec').toBe('online')

    const channelId = await getChannelId('human')
    const marker = `scripted-fail-e2e-${Date.now()}`
    const startMs = Date.now()

    await createReminder({
      bot_name: COORDINATOR_BOT,
      topic_id: 'human',
      content: marker,
      delay_ms: 15_000,
      meta_type: 'alert',
      // script exits 1 → message fires; stdout is appended
      script: 'echo "script-ran-ok"; exit 1',
    })

    const post = await waitForPost(channelId, {
      containsText: marker,
      timeoutMs: 60_000,
      afterMs: startMs,
    })
    expect(post.message).toContain(marker)
    expect(post.message).toContain('script-ran-ok')
  })
})

// ── 4. scripted reminder — exits zero → suppressed ───────────────────────────

describe('Reminders — scripted (exit zero is suppressed)', () => {
  it('does NOT post a message when script exits 0', async () => {
    const channelId = await getChannelId('human')
    const marker = `scripted-pass-e2e-${Date.now()}`
    const startMs = Date.now()

    await createReminder({
      bot_name: COORDINATOR_BOT,
      topic_id: 'human',
      content: marker,
      delay_ms: 10_000,
      meta_type: 'alert',
      script: 'exit 0',
    })

    // Wait long enough for the scheduler to have fired (tick is 10s, give it 45s)
    await sleep(45_000)

    // The marker message must NOT appear in the channel
    const res = await fetch(
      `${MATTERMOST_URL}/api/v4/channels/${channelId}/posts?since=${startMs}&per_page=100`,
      { headers: { Authorization: `Bearer ${process.env['MM_ADMIN_TOKEN'] ?? ''}` } },
    )
    const data = (await res.json()) as { order: string[]; posts: Record<string, { message: string }> }
    const found = (data.order ?? []).some((id) => data.posts[id]!.message.includes(marker))
    expect(found, 'Scripted reminder with exit 0 must NOT fire a message').toBe(false)
  })
})
