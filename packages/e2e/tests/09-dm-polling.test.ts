/**
 * 09-dm-polling.test.ts
 *
 * Verifies that bot accounts receive and respond to DMs via polling.
 * Bot accounts don't receive WS `posted` events for DM channels, so the agent
 * polls for new DM posts every 3 seconds. This test validates that polling works
 * end-to-end: admin sends a DM → bot picks it up via polling → bot replies.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { orchFetch, mmFetch, waitForPost } from './helpers.js'
import type { Bot } from '@yeap/shared'

let coordBot: Bot
let adminUserId: string
let dmChannelId: string

beforeAll(async () => {
  // Get coordinator bot (already online from setup)
  const res = await orchFetch('/registry/bots')
  expect(res.status, 'Registry should be accessible').toBe(200)
  const bots = (await res.json()) as Bot[]
  const coord = bots.find((b) => b.is_coordinator && b.status === 'online')
  if (!coord) throw new Error('Coordinator bot not online — run tests after setup completes')
  if (!coord.mattermost_user_id) throw new Error('Coordinator has no Mattermost user ID')
  coordBot = coord
  console.log(`Using coordinator: ${coord.name} (MM user: ${coord.mattermost_user_id})`)

  // Get admin user ID
  const adminRes = await mmFetch('/users/me')
  expect(adminRes.status).toBe(200)
  const admin = (await adminRes.json()) as { id: string; username: string }
  adminUserId = admin.id
  console.log(`Admin user: ${admin.username} (${adminUserId})`)

  // Create (or reuse) DM channel between admin and coordinator bot
  const dmRes = await mmFetch('/channels/direct', {
    method: 'POST',
    body: JSON.stringify([adminUserId, coord.mattermost_user_id]),
  })
  expect(dmRes.status, 'Should create DM channel').toBeGreaterThanOrEqual(200)
  expect(dmRes.status, 'Should create DM channel').toBeLessThan(300)
  const dm = (await dmRes.json()) as { id: string; type: string }
  dmChannelId = dm.id
  console.log(`DM channel: ${dmChannelId} (type: ${dm.type})`)
}, 30_000)

describe('DM polling — bot responds to direct messages', () => {
  it('DM channel is a direct channel (type D)', async () => {
    const res = await mmFetch(`/channels/${dmChannelId}`)
    expect(res.status).toBe(200)
    const ch = (await res.json()) as { id: string; type: string }
    expect(ch.type).toBe('D')
  })

  it('coordinator responds to a DM within 90s via polling', async () => {
    const marker = `dm-e2e-${Date.now()}`
    const startMs = Date.now()

    // Post DM as the admin user
    const postRes = await mmFetch('/posts', {
      method: 'POST',
      body: JSON.stringify({
        channel_id: dmChannelId,
        message: `E2E DM test — please respond with "got-it". Token: ${marker}`,
      }),
    })
    expect(postRes.status, 'Should be able to post DM').toBe(201)
    const triggerPost = (await postRes.json()) as { id: string }
    console.log(`Posted DM trigger: ${triggerPost.id}`)

    // Bot doesn't receive WS events for DMs — it polls every 3s.
    // Wait up to 90s for a reply from the coordinator.
    const reply = await waitForPost(dmChannelId, {
      containsText: 'got-it',
      timeoutMs: 90_000,
      afterMs: startMs,
    })

    expect(reply.message.toLowerCase()).toContain('got-it')
    console.log(`Bot replied: "${reply.message.slice(0, 120)}"`)
  })

  it('coordinator responds to a second DM (polling continues after first)', async () => {
    const marker = `dm-followup-${Date.now()}`
    const startMs = Date.now()

    const postRes = await mmFetch('/posts', {
      method: 'POST',
      body: JSON.stringify({
        channel_id: dmChannelId,
        message: `E2E follow-up DM — please respond with "received". Token: ${marker}`,
      }),
    })
    expect(postRes.status).toBe(201)

    const reply = await waitForPost(dmChannelId, {
      containsText: 'received',
      timeoutMs: 90_000,
      afterMs: startMs,
    })

    expect(reply.message.toLowerCase()).toContain('received')
    console.log(`Bot replied to follow-up: "${reply.message.slice(0, 120)}"`)
  })
})
