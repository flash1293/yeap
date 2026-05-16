/**
 * 04-reminders.test.ts
 *
 * Tests that a one-shot reminder fires and delivers to the MM human channel.
 */
import { describe, it, expect } from 'vitest'
import { REMINDER_URL, getChannelId, waitForPost, sleep } from './helpers.js'
import type { Reminder } from '@yeap/shared'

const COORDINATOR_BOT = process.env['COORDINATOR_NAME'] ?? 'Coordinator'

describe('Reminders', () => {
  it('one-shot reminder delivers to Mattermost within 45s', async () => {
    const channelId = await getChannelId('human')
    const marker = `reminder-e2e-${Date.now()}`
    const fireAt = Date.now() + 20_000 // fire in 20s
    const startMs = Date.now()

    // Create the reminder
    const res = await fetch(`${REMINDER_URL}/reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bot_name: COORDINATOR_BOT,
        topic_id: 'human',
        content: marker,
        fire_at: fireAt,
        meta_type: 'alert',
      }),
    })
    expect(res.status, 'Expected 201 from reminder service').toBe(201)
    const reminder = (await res.json()) as Reminder
    console.log(`Created reminder ${reminder.id}, fires at ${new Date(fireAt).toISOString()}`)

    // Wait for it to appear in the channel
    const post = await waitForPost(channelId, {
      containsText: marker,
      timeoutMs: 45_000,
      afterMs: startMs,
    })
    expect(post.message).toContain(marker)
    console.log(`Reminder delivered: "${post.message.slice(0, 80)}"`)
  })

  it('reminder appears in list then is deleted', async () => {
    const res = await fetch(`${REMINDER_URL}/reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bot_name: COORDINATOR_BOT,
        topic_id: 'human',
        content: 'cleanup-test',
        fire_at: Date.now() + 3_600_000, // 1h from now
        meta_type: 'alert',
      }),
    })
    expect(res.status).toBe(201)
    const reminder = (await res.json()) as Reminder

    // List reminders
    const listRes = await fetch(`${REMINDER_URL}/reminders?bot_name=${encodeURIComponent(COORDINATOR_BOT)}`)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as Reminder[]
    expect(list.some((r) => r.id === reminder.id)).toBe(true)

    // Delete it
    const delRes = await fetch(`${REMINDER_URL}/reminders/${reminder.id}`, { method: 'DELETE' })
    expect(delRes.status).toBe(200)

    await sleep(500)

    // Should not appear in list anymore
    const listRes2 = await fetch(`${REMINDER_URL}/reminders?bot_name=${encodeURIComponent(COORDINATOR_BOT)}`)
    const list2 = (await listRes2.json()) as Reminder[]
    expect(list2.some((r) => r.id === reminder.id)).toBe(false)
  })
})
