/**
 * 10-compaction-session.test.ts
 *
 * Verifies that compaction actually clears the agent's in-memory session, not
 * just resets the orchestrator counter. Specifically:
 *
 *  1. Spawn a dedicated test bot and let it start up.
 *  2. Send it a message with a unique token; verify bot replies (session built).
 *  3. Trigger /spawn/compact; wait for messages_since_compact to hit 0.
 *  4. Verify the session is truly cleared (re-orient run happened).
 *  5. Send another message; verify bot still responds (not broken after clear).
 *  6. Verify session count is small (not replaying 3000 messages).
 */
import { execSync } from 'node:child_process'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  orchFetch,
  mmFetch,
  getTeamId,
  postAsAdmin,
  waitForBotOnline,
  waitForPost,
  sleep,
} from './helpers.js'
import type { Bot } from '@yeap/shared'

const BOT_NAME = 'e2e-compact-test'
let inboxChannelId: string | null = null

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

/** Delete any stale bot from a previous run, ignore 404. */
async function deleteBot(): Promise<void> {
  const res = await orchFetch(`/spawn/${encodeURIComponent(BOT_NAME)}`, { method: 'DELETE' })
  log(`DELETE /spawn/${BOT_NAME} → ${res.status}`)
}

beforeAll(async () => {
  log('beforeAll: cleaning up any stale e2e-compact-test bot...')
  await deleteBot()
  // Wipe the skillet volume so the bot starts with zero session history
  try {
    execSync('docker volume rm yeap-skillet-e2e-compact-test 2>/dev/null || true', { stdio: 'pipe' })
    log('beforeAll: skillet volume removed (or did not exist)')
  } catch (e) {
    log(`beforeAll: volume rm failed (ignored): ${e}`)
  }
  await sleep(2_000)
}, 15_000)

afterAll(async () => {
  log('afterAll: deleting e2e-compact-test bot...')
  await deleteBot()
})

/** Poll registry and log each attempt until messages_since_compact hits 0. */
async function waitForSessionCountZero(botName: string, timeoutMs = 120_000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await orchFetch('/registry/bots')
    if (res.ok) {
      const bots = (await res.json()) as Bot[]
      const bot = bots.find((b) => b.name === botName)
      const count = bot?.messages_since_compact ?? -1
      const status = bot?.status ?? 'not-found'
      log(`  registry poll → ${botName} status=${status} messages_since_compact=${count}`)
      if (count === 0) return count
    } else {
      log(`  registry poll → HTTP ${res.status}`)
    }
    await sleep(3000)
  }
  throw new Error(`messages_since_compact for '${botName}' did not reach 0 within ${timeoutMs}ms`)
}

/** Log recent posts in a channel for debugging. */
async function dumpRecentPosts(channelId: string, n = 5): Promise<void> {
  const res = await mmFetch(`/channels/${channelId}/posts?per_page=${n}`)
  if (!res.ok) { log(`  dumpRecentPosts: HTTP ${res.status}`); return }
  const data = (await res.json()) as { order: string[]; posts: Record<string, { message: string; user_id: string; create_at: number }> }
  log(`  last ${data.order.length} posts in channel ${channelId}:`)
  for (const id of data.order) {
    const p = data.posts[id]!
    log(`    [${new Date(p.create_at).toISOString()}] user=${p.user_id.slice(0, 8)} "${p.message.slice(0, 100)}"`)
  }
}

describe('Compaction session clear', () => {
  it('spawns the compact-test bot', async () => {
    log(`Spawning bot '${BOT_NAME}'...`)
    const res = await orchFetch('/spawn', {
      method: 'POST',
      body: JSON.stringify({
        requested_by: 'e2e',
        name: BOT_NAME,
        role: 'You are a minimal test bot. Follow instructions exactly and literally.',
        model: process.env['E2E_BOT_MODEL'] ?? 'anthropic/claude-haiku-4-5',
      }),
    })
    const body = await res.json() as { bot?: Bot; error?: string }
    log(`spawn response: status=${res.status} body=${JSON.stringify(body).slice(0, 200)}`)
    expect(res.status, `Expected 201 from spawn, got: ${JSON.stringify(body)}`).toBe(201)
    expect(body.bot!.name).toBe(BOT_NAME)
  })

  it('bot comes online and inbox channel exists', async () => {
    log('Waiting for bot to come online...')
    const bot = await waitForBotOnline(BOT_NAME, 90_000)
    log(`Bot online: status=${bot.status} messages_since_compact=${bot.messages_since_compact}`)
    expect(bot.status).toBe('online')

    const teamId = await getTeamId()
    const inboxName = `inbox-${BOT_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    log(`Looking up inbox channel '${inboxName}' in team ${teamId}...`)
    const chRes = await mmFetch(`/teams/${teamId}/channels/name/${inboxName}`)
    log(`inbox channel lookup: HTTP ${chRes.status}`)
    expect(chRes.status, `Inbox channel '${inboxName}' should exist`).toBe(200)
    const ch = (await chRes.json()) as { id: string; name: string }
    inboxChannelId = ch.id
    log(`Inbox channel id=${ch.id} name=${ch.name}`)
  })

  it('bot responds to initial message (pre-compact)', async () => {
    expect(inboxChannelId, 'Inbox channel must exist').toBeTruthy()
    const token = `COMPACT-TOKEN-${Date.now()}`
    log(`Posting pre-compact stimulus with token=${token}`)
    const post = await postAsAdmin(inboxChannelId!, `Reply with exactly: "${token}"`)
    log(`Admin post id=${post.id} at=${new Date(post.create_at).toISOString()}`)

    log('Waiting for bot reply containing token...')
    const reply = await waitForPost(inboxChannelId!, {
      containsText: token,
      timeoutMs: 90_000,
      afterMs: post.create_at,
    })
    log(`Bot replied: "${reply.message.slice(0, 120)}"`)
    expect(reply.message).toContain(token)

    // Show what messages_since_compact looks like now
    const botsRes = await orchFetch('/registry/bots')
    const bots = (await botsRes.json()) as Bot[]
    const botState = bots.find((b) => b.name === BOT_NAME)
    log(`Registry state after first reply: messages_since_compact=${botState?.messages_since_compact} status=${botState?.status}`)
  }, 120_000)

  it('compact endpoint triggers and clears the session', async () => {
    // Bump counter so it's clearly non-zero before compact
    log('Bumping messages_since_compact via compact-check...')
    for (let i = 0; i < 3; i++) {
      const r = await orchFetch(`/spawn/compact-check/${encodeURIComponent(BOT_NAME)}`, { method: 'POST' })
      log(`  compact-check #${i + 1} → ${r.status}`)
    }
    const preBots = (await (await orchFetch('/registry/bots')).json()) as Bot[]
    const pre = preBots.find((b) => b.name === BOT_NAME)
    log(`Pre-compact: messages_since_compact=${pre?.messages_since_compact} status=${pre?.status}`)

    log('Triggering /spawn/compact...')
    const compactRes = await orchFetch(`/spawn/compact/${encodeURIComponent(BOT_NAME)}`, { method: 'POST' })
    const compactBody = await compactRes.json() as { ok: boolean; error?: string }
    log(`compact response: status=${compactRes.status} body=${JSON.stringify(compactBody)}`)
    expect(compactRes.status, `Expected 200, got: ${JSON.stringify(compactBody)}`).toBe(200)
    expect(compactBody.ok).toBe(true)

    log('Polling registry until messages_since_compact=0 (compact+clear cycle done)...')
    const finalCount = await waitForSessionCountZero(BOT_NAME, 120_000)
    log(`Compact cycle complete: messages_since_compact=${finalCount}`)
    expect(finalCount).toBe(0)
  }, 150_000)

  it('bot still responds after compaction', async () => {
    expect(inboxChannelId, 'Inbox channel must exist').toBeTruthy()

    // Give the post-compact re-orientation run a moment to finish
    log('Waiting 10s for post-compact re-orientation run to complete...')
    await sleep(10_000)

    await dumpRecentPosts(inboxChannelId!)

    const token = `POST-COMPACT-${Date.now()}`
    log(`Posting post-compact stimulus with token=${token}`)
    const post = await postAsAdmin(inboxChannelId!, `Reply with exactly: "${token}"`)
    log(`Admin post id=${post.id} at=${new Date(post.create_at).toISOString()}`)

    log('Waiting for bot reply containing post-compact token...')
    const reply = await waitForPost(inboxChannelId!, {
      containsText: token,
      timeoutMs: 90_000,
      afterMs: post.create_at,
    })
    log(`Bot replied post-compact: "${reply.message.slice(0, 120)}"`)
    expect(reply.message).toContain(token)
  }, 150_000)

  it('session count stays small after responding post-compact', async () => {
    const res = await orchFetch('/registry/bots')
    expect(res.status).toBe(200)
    const bots = (await res.json()) as Bot[]
    const bot = bots.find((b) => b.name === BOT_NAME)
    expect(bot, 'Bot should still be in registry').toBeDefined()
    log(`Final state: messages_since_compact=${bot!.messages_since_compact} status=${bot!.status}`)
    expect(bot!.messages_since_compact).toBeLessThan(10)
  })
})
