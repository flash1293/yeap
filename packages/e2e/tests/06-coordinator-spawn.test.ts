/**
 * 06-coordinator-spawn.test.ts
 *
 * Verifies end-to-end bot spawning via the coordinator:
 *   1. Coordinator is online
 *   2. Sending a natural-language "spawn a bot" request to the human channel
 *      causes the coordinator to call spawn_bot and a new bot to appear in the
 *      registry
 *   3. The spawned bot eventually reaches 'online' status
 *
 * Teardown: deletes the spawned bot after the suite.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  orchFetch,
  getChannelId,
  postAsAdmin,
  waitForBotOnline,
  sleep,
} from './helpers.js'
import type { Bot } from '@yeap/shared'

/** Name we ask the coordinator to use — must match the orchestrator name regex */
const REQUESTED_BOT_NAME = 'e2e-spawn-test'

let spawnedBotName: string | null = null

/** Clean up any leftover bot with the target name before and after the suite. */
async function deleteBotIfExists(name: string): Promise<void> {
  try {
    await orchFetch(`/spawn/${encodeURIComponent(name)}`, { method: 'DELETE' })
  } catch {
    // ignore — bot may not exist
  }
}

beforeAll(async () => {
  await deleteBotIfExists(REQUESTED_BOT_NAME)
  // Brief pause so the delete fully propagates before we start watching
  await sleep(1000)
})

afterAll(async () => {
  const name = spawnedBotName ?? REQUESTED_BOT_NAME
  await deleteBotIfExists(name)
})

/** Poll the registry until a bot whose name is NOT in `knownNames` appears. */
async function waitForNewBot(knownNames: Set<string>, timeoutMs = 180_000): Promise<Bot> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await orchFetch('/registry/bots')
    if (res.ok) {
      const bots = (await res.json()) as Bot[]
      const newBot = bots.find((b) => !b.is_coordinator && !knownNames.has(b.name))
      if (newBot) return newBot
    }
    await sleep(4000)
  }
  throw new Error(
    `No new non-coordinator bot appeared in the registry within ${timeoutMs}ms`,
  )
}

describe('Coordinator spawns a bot via Mattermost', () => {
  it('coordinator is online', async () => {
    const res = await orchFetch('/registry/bots')
    expect(res.status).toBe(200)
    const bots = (await res.json()) as Bot[]
    const coord = bots.find((b) => b.is_coordinator)
    expect(coord, 'Coordinator not found in registry').toBeTruthy()
    expect(coord!.status, 'Coordinator must be online').toBe('online')
  })

  it('posting a spawn request causes the coordinator to call spawn_bot', async () => {
    // Snapshot known bots before we trigger the spawn
    const beforeRes = await orchFetch('/registry/bots')
    expect(beforeRes.status).toBe(200)
    const beforeBots = (await beforeRes.json()) as Bot[]
    const beforeNames = new Set(beforeBots.map((b) => b.name))

    const humanChannelId = await getChannelId('human')

    await postAsAdmin(
      humanChannelId,
      `Please spawn a new bot named exactly "${REQUESTED_BOT_NAME}" with role ` +
        `"You are a helpful assistant created for automated testing." ` +
        `Use the default model. Do not ask clarifying questions.`,
    )

    console.log(`Waiting for a new bot to appear in the registry…`)
    const newBot = await waitForNewBot(beforeNames, 180_000)
    spawnedBotName = newBot.name
    console.log(`New bot detected: ${newBot.name}`)

    // The coordinator should have used the name we requested (or something close)
    expect(newBot.name.toLowerCase()).toContain('e2e')
  })

  it('spawned bot comes online', async () => {
    expect(spawnedBotName, 'Previous test must have detected a spawned bot').toBeTruthy()
    const bot = await waitForBotOnline(spawnedBotName!, 120_000)
    expect(bot.status).toBe('online')
  })
})
