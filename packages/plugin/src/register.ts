import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'

const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] ?? 'http://orchestrator:3000'
const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'
const BOT_ROLE = process.env['BOT_ROLE'] ?? ''
const BOT_MODEL_RAW = process.env['BOT_MODEL'] ?? ''
const BOT_MODEL: { providerID: string; modelID: string } | null = (() => {
  if (!BOT_MODEL_RAW) return null
  const idx = BOT_MODEL_RAW.indexOf('/')
  if (idx === -1) return null
  return { providerID: BOT_MODEL_RAW.slice(0, idx), modelID: BOT_MODEL_RAW.slice(idx + 1) }
})()
const SKILLET_PATH = process.env['SKILLET_PATH'] ?? '/skillet'
const SESSION_FILE = join(SKILLET_PATH, 'session.json')
const OPENCODE_URL = 'http://localhost:4096'

const INITIAL_PROMPT = `[YEAP FIRST BOOT]
You are coming online for the first time as ${BOT_NAME}.

Your role: ${BOT_ROLE}

Please do the following in order:

1. Read the platform docs at /shared/yeap-docs/platform.md so you understand how YEAP works.
2. Check /skillet/memory.md — if it exists, read it to restore any prior context.
3. Check your Mattermost inbox channel (inbox-${BOT_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-')}) and any other subscribed channels for recent messages. Use write_to_chat to read/respond.
4. If there are outstanding requests or tasks addressed to you, begin working on them.
5. Introduce yourself to the human by writing a brief message to the "human" topic via write_to_chat("human", ...) — mention your name, your role, and that you are now online.`

type SessionStore = { session_id: string }

export async function registerBot(
  client: import('@opencode-ai/plugin').PluginInput['client'],
): Promise<void> {
  const opencode_url = `http://${os.hostname()}:4096`

  // 1. Restore or create standing session
  const { session_id, is_new } = await getOrCreateSession(client)

  // 2. Register with orchestrator
  try {
    await fetch(`${ORCHESTRATOR_URL}/registry/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: BOT_NAME, role_description: BOT_ROLE, opencode_url }),
    })
  } catch (err) {
    console.error('[yeap-plugin] Failed to register with orchestrator:', err)
  }

  // 3. Update session_id
  try {
    await fetch(`${ORCHESTRATOR_URL}/registry/bots/${encodeURIComponent(BOT_NAME)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id }),
    })
  } catch (err) {
    console.error('[yeap-plugin] Failed to update session_id:', err)
  }

  // 4. On first boot, send the orientation prompt
  if (is_new) {
    await deliverInitialPrompt(session_id)
  }
}

async function deliverInitialPrompt(session_id: string): Promise<void> {
  try {
    const body: Record<string, unknown> = {
      parts: [{ type: 'text', text: INITIAL_PROMPT }],
    }
    if (BOT_MODEL) body['model'] = BOT_MODEL

    const res = await fetch(`${OPENCODE_URL}/session/${session_id}/prompt_async`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok && res.status !== 204) {
      const text = await res.text()
      console.error(`[yeap-plugin] Initial prompt failed ${res.status}: ${text}`)
    } else {
      console.log('[yeap-plugin] Initial orientation prompt delivered')
    }
  } catch (err) {
    console.error('[yeap-plugin] Failed to deliver initial prompt:', err)
  }
}

async function getOrCreateSession(
  client: import('@opencode-ai/plugin').PluginInput['client'],
): Promise<{ session_id: string; is_new: boolean }> {
  // Trust the stored session unconditionally. OpenCode sessions persist on the
  // yeap-opencode-<slug> volume, so the session will still be there after a
  // container restart. Verifying via client.session.get() is dangerous: the
  // call can fail during the startup window (before OpenCode finishes loading),
  // causing the code to fall through and create a SECOND session — leaking the
  // old one. One session per bot, always.
  if (existsSync(SESSION_FILE)) {
    try {
      const { session_id } = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as SessionStore
      if (session_id) return { session_id, is_new: false }
    } catch {
      // Corrupt file — fall through to create new
    }
  }

  // No session file — true first boot: create the standing session.
  const res = await client.session.create({ body: { title: `${BOT_NAME} standing session` } })
  const session_id = res.data!.id
  writeFileSync(SESSION_FILE, JSON.stringify({ session_id }), 'utf8')
  return { session_id, is_new: true }
}
