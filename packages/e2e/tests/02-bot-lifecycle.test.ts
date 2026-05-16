/**
 * 02-bot-lifecycle.test.ts
 *
 * Tests bot spawn → comes online → posts intro → teardown.
 * Creates a temporary bot named "test-e2e-bot" and cleans it up.
 */
import { describe, it, expect, afterAll } from 'vitest'
import {
  orchFetch,
  mmFetch,
  waitForBotOnline,
  waitForPost,
  getChannelId,
  sleep,
} from './helpers.js'
import type { Bot } from '@yeap/shared'

const BOT_NAME = 'e2e-test-bot'
let spawnedBot: Bot | null = null

async function teardownBot(): Promise<void> {
  if (!spawnedBot) return
  try {
    await orchFetch(`/spawn/${encodeURIComponent(BOT_NAME)}`, { method: 'DELETE' })
  } catch {
    // ignore
  }
  spawnedBot = null
}

afterAll(teardownBot)

describe('Bot lifecycle', () => {
  it('spawn creates a new bot with MM identity', async () => {
    const res = await orchFetch('/spawn', {
      method: 'POST',
      body: JSON.stringify({
        requested_by: 'e2e',
        name: BOT_NAME,
        role: 'E2E test bot — ignore me',
        model: process.env['E2E_BOT_MODEL'] ?? 'anthropic/claude-haiku-4-5',
      }),
    })
    expect(res.status, 'Expected 201 from spawn').toBe(201)
    const body = (await res.json()) as { bot: Bot }
    spawnedBot = body.bot
    expect(body.bot.name).toBe(BOT_NAME)
    expect(body.bot.mattermost_user_id, 'Bot should have MM user ID').toBeTruthy()
    console.log(`Spawned bot: ${BOT_NAME}, MM user: ${body.bot.mattermost_user_id}`)
  })

  it('bot comes online within 90s', async () => {
    const bot = await waitForBotOnline(BOT_NAME, 90_000)
    expect(bot.status).toBe('online')
    console.log(`Bot ${BOT_NAME} is online`)
  })

  it('bot posts an intro message in the human channel within 120s', async () => {
    const channelId = await getChannelId('human')
    const startMs = Date.now()

    const post = await waitForPost(channelId, {
      containsText: BOT_NAME,
      timeoutMs: 120_000,
      afterMs: startMs - 5_000,
    })
    expect(post.message).toContain(BOT_NAME)
    console.log(`Intro post found: "${post.message.slice(0, 80)}…"`)
  })

  it('bot appears in registry with correct fields', async () => {
    const res = await orchFetch('/registry/bots')
    expect(res.status).toBe(200)
    const bots = (await res.json()) as Bot[]
    const bot = bots.find((b) => b.name === BOT_NAME)
    expect(bot, 'Bot not found in registry').toBeTruthy()
    expect(bot!.mattermost_user_id).toBeTruthy()
    expect(bot!.is_coordinator).toBe(false)
  })

  it('bot MM user is disabled after teardown', async () => {
    const bot = spawnedBot
    expect(bot, 'Bot must have been spawned').toBeTruthy()
    const mmUserId = bot!.mattermost_user_id!

    await teardownBot()
    await sleep(3000)

    const res = await mmFetch(`/users/${mmUserId}`)
    expect(res.status).toBe(200)
    const user = (await res.json()) as { delete_at: number }
    // Disabled users have delete_at > 0
    expect(user.delete_at, 'MM user should be disabled (delete_at > 0) after teardown').toBeGreaterThan(0)
  })
})
