/**
 * 08-compaction.test.ts
 *
 * Verifies that context compaction works end-to-end:
 *  1. Coordinator is online
 *  2. POST /spawn/compact/:name returns { ok: true }
 *  3. messages_since_compact resets to 0 in the registry
 *  4. Bot is still online after compaction (agent survived the compact prompt)
 *  5. messages_since_compact auto-increments via /spawn/compact-check/:name
 *  6. Auto-compact fires when threshold is reached (threshold is 10 in prod;
 *     we call compact-check in a loop and assert the counter resets)
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { ORCHESTRATOR_URL, orchFetch, waitForBotOnline, sleep } from './helpers.js'
import type { Bot } from '@yeap/shared'

const COORDINATOR_BOT = process.env['COORDINATOR_NAME'] ?? 'Coordinator'

describe('Compaction', () => {
  beforeAll(async () => {
    // Make sure coordinator is reachable before running any compaction tests
    await waitForBotOnline(COORDINATOR_BOT, 30_000)
  })

  it('POST /spawn/compact returns { ok: true }', async () => {
    const res = await orchFetch(`/spawn/compact/${encodeURIComponent(COORDINATOR_BOT)}`, {
      method: 'POST',
    })
    const body = (await res.json()) as { ok: boolean; error?: string }
    expect(res.status, `Expected 200, got ${res.status}: ${body.error ?? JSON.stringify(body)}`).toBe(200)
    expect(body.ok).toBe(true)
  })

  it('messages_since_compact resets to 0 after compact', async () => {
    // compact-check a few times to drive the counter above zero first
    for (let i = 0; i < 3; i++) {
      await orchFetch(`/spawn/compact-check/${encodeURIComponent(COORDINATOR_BOT)}`, { method: 'POST' })
    }

    // Now compact
    const res = await orchFetch(`/spawn/compact/${encodeURIComponent(COORDINATOR_BOT)}`, { method: 'POST' })
    expect(res.status).toBe(200)

    // Verify registry shows 0
    const botsRes = await orchFetch('/registry/bots')
    expect(botsRes.status).toBe(200)
    const bots = (await botsRes.json()) as Bot[]
    const coord = bots.find((b) => b.name === COORDINATOR_BOT)
    expect(coord, 'Coordinator should exist in registry').toBeDefined()
    expect(coord!.messages_since_compact).toBe(0)
  })

  it('bot is still online after compaction', async () => {
    // Give the compact prompt a few seconds to be processed
    await sleep(8_000)
    const bot = await waitForBotOnline(COORDINATOR_BOT, 30_000)
    expect(bot.status).toBe('online')
  })

  it('messages_since_compact increments via compact-check', async () => {
    // Reset to known state
    await orchFetch(`/spawn/compact/${encodeURIComponent(COORDINATOR_BOT)}`, { method: 'POST' })

    const before = await (await orchFetch('/registry/bots')).json() as Bot[]
    const beforeCount = before.find((b) => b.name === COORDINATOR_BOT)!.messages_since_compact

    await orchFetch(`/spawn/compact-check/${encodeURIComponent(COORDINATOR_BOT)}`, { method: 'POST' })
    await orchFetch(`/spawn/compact-check/${encodeURIComponent(COORDINATOR_BOT)}`, { method: 'POST' })

    const after = await (await orchFetch('/registry/bots')).json() as Bot[]
    const afterCount = after.find((b) => b.name === COORDINATOR_BOT)!.messages_since_compact
    expect(afterCount).toBe(beforeCount + 2)
  })

  it('auto-compact fires and resets counter when threshold is reached', async () => {
    // Reset
    await orchFetch(`/spawn/compact/${encodeURIComponent(COORDINATOR_BOT)}`, { method: 'POST' })

    // Drive counter to 10 (the AUTO_COMPACT_THRESHOLD in spawn.ts)
    // The 10th call should trigger auto-compact, which sets the counter back to 0
    for (let i = 0; i < 10; i++) {
      await orchFetch(`/spawn/compact-check/${encodeURIComponent(COORDINATOR_BOT)}`, { method: 'POST' })
    }

    // Give a moment for the async auto-compact fetch to complete
    await sleep(3_000)

    const botsRes = await orchFetch('/registry/bots')
    const bots = (await botsRes.json()) as Bot[]
    const coord = bots.find((b) => b.name === COORDINATOR_BOT)!
    // After auto-compact the counter should be 0
    expect(coord.messages_since_compact).toBe(0)
    // last_compact_at should be recent
    expect(coord.last_compact_at).toBeGreaterThan(Date.now() - 30_000)
  })

  it('bot is still healthy after all compaction operations', async () => {
    await sleep(5_000)
    const bot = await waitForBotOnline(COORDINATOR_BOT, 30_000)
    expect(bot.status).toBe('online')
  })
})
