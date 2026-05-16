/**
 * Register this bot with the orchestrator on startup.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] ?? 'http://orchestrator:3000'
const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'
const BOT_ROLE = process.env['BOT_ROLE'] ?? ''
const SKILLET_PATH = process.env['SKILLET_PATH'] ?? '/skillet'
const ADMIN_SERVER_PORT = 4096

// Admin server URL uses the container hostname (Docker network DNS)
function selfAdminUrl(): string {
  const hostname = process.env['HOSTNAME'] ?? BOT_NAME.toLowerCase().replace(/[\s_]+/g, '-')
  return `http://yeap-bot-${BOT_NAME.toLowerCase().replace(/[\s_]+/g, '-')}:${ADMIN_SERVER_PORT}`
}

export async function registerBot(): Promise<{ is_new: boolean }> {
  const isNew = !existsSync(join(SKILLET_PATH, 'session.jsonl'))

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/registry/bots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: BOT_NAME,
          role_description: BOT_ROLE,
          opencode_url: selfAdminUrl(),
        }),
      })
      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        console.error(`[register] Orchestrator returned ${res.status}: ${body.error ?? ''}`)
      } else {
        console.log(`[register] Registered with orchestrator (attempt ${attempt})`)
        return { is_new: isNew }
      }
    } catch (err) {
      console.error(`[register] Attempt ${attempt} failed:`, err)
    }
    await new Promise((r) => setTimeout(r, attempt * 2000))
  }

  console.error('[register] Failed to register after 10 attempts — continuing anyway')
  return { is_new: isNew }
}

export function buildInitialPrompt(isNew: boolean): string {
  const botName = BOT_NAME
  const botRole = BOT_ROLE

  if (isNew) {
    return `[YEAP FIRST BOOT]
You are coming online for the first time as ${botName}.

Your role: ${botRole}

Please do the following in order:

1. Read /shared/yeap-docs/platform.md if it exists, to understand how YEAP works.
2. Check /skillet/memory.md — if it exists, read it to restore any prior context.
3. Use post_to_channel to introduce yourself to the "human" channel with a brief message
   mentioning your name, role, and that you are now online.
4. If you are the coordinator, explain that the human can assign tasks by messaging you here.`
  }

  return `[YEAP RESTART]
You have just come back online after a restart as ${botName}.

1. Check /skillet/memory.md to restore prior context.
2. Check your inbox channel for any messages that arrived while you were offline.
3. Resume any outstanding tasks.`
}
