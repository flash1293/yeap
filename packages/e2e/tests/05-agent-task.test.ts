/**
 * 05-agent-task.test.ts
 *
 * Verifies that a spawned bot:
 *   1. Receives a task message via Mattermost (real-world message flow)
 *   2. Executes a shell command (node one-liner — always available in the bot image)
 *   3. Writes the result to the shared filesystem (/shared/)
 *   4. The result is readable via the orchestrator files API
 *
 * The marker token ensures each run is isolated.
 */
import { describe, it, expect, afterAll } from 'vitest'
import {
  orchFetch,
  mmFetch,
  waitForBotOnline,
  getTeamId,
  postAsAdmin,
  sleep,
} from './helpers.js'
import type { Bot } from '@yeap/shared'

const BOT_NAME = 'e2e-task-bot'
let spawnedBot: Bot | null = null

async function teardown(): Promise<void> {
  if (!spawnedBot) return
  try {
    await orchFetch(`/spawn/${encodeURIComponent(BOT_NAME)}`, { method: 'DELETE' })
  } catch { /* ignore */ }
  spawnedBot = null
}

afterAll(teardown)

/** Poll the orchestrator files API until a shared file appears and contains expected text. */
async function waitForSharedFile(
  filename: string,
  containsText: string,
  timeoutMs = 120_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await orchFetch(`/pwa/files/read?path=shared/${encodeURIComponent(filename)}`)
    if (res.ok) {
      const body = (await res.json()) as { content?: string; error?: string }
      if (body.content && body.content.includes(containsText)) {
        return body.content
      }
    }
    await sleep(3000)
  }
  throw new Error(`File /shared/${filename} did not contain "${containsText}" within ${timeoutMs}ms`)
}

describe('Agent task execution via Mattermost', () => {
  it('spawns the task bot', async () => {
    const res = await orchFetch('/spawn', {
      method: 'POST',
      body: JSON.stringify({
        requested_by: 'e2e',
        name: BOT_NAME,
        role: 'You are a task execution bot. When asked to run a command and save the output to a file, you MUST use the bash tool to run the command and the write_file tool to save the result. Always follow instructions exactly.',
        model: process.env['E2E_BOT_MODEL'] ?? 'anthropic/claude-haiku-4-5',
      }),
    })
    expect(res.status, 'Expected 201 from spawn').toBe(201)
    const body = (await res.json()) as { bot: Bot }
    spawnedBot = body.bot
    expect(body.bot.name).toBe(BOT_NAME)
  })

  it('bot comes online', async () => {
    const bot = await waitForBotOnline(BOT_NAME, 90_000)
    expect(bot.status).toBe('online')
  })

  it('bot receives MM message, runs a node command, and writes result to /shared/', async () => {
    const marker = `task-${Date.now()}`
    const outputFile = `e2e-result-${marker}.json`

    // Find the bot's inbox channel (created at spawn time)
    const teamId = await getTeamId()
    const inboxName = `inbox-${BOT_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    const inboxRes = await mmFetch(`/teams/${teamId}/channels/name/${inboxName}`)
    expect(inboxRes.status, `Inbox channel ${inboxName} should exist`).toBe(200)
    const inbox = (await inboxRes.json()) as { id: string }

    // Post the task via Mattermost — this is the real-world trigger path
    await postAsAdmin(
      inbox.id,
      `Please run the following node command and save its JSON output to the file /shared/${outputFile}:\n\n` +
      `node -e "process.stdout.write(JSON.stringify({marker:'${marker}',sum:${2 + 2},host:require('os').hostname()}))"\n\n` +
      `Use the bash tool to run the command, capture its stdout, then use write_file to write the result to /shared/${outputFile}.`,
    )

    console.log(`Waiting for /shared/${outputFile} to appear…`)

    // Wait for the bot to write the file to the shared volume
    const content = await waitForSharedFile(outputFile, marker, 120_000)
    const parsed = JSON.parse(content) as { marker: string; sum: number; host: string }

    expect(parsed.marker).toBe(marker)
    expect(parsed.sum).toBe(4)
    expect(typeof parsed.host).toBe('string')

    console.log(`Result written by bot: ${JSON.stringify(parsed)}`)
  })


})
