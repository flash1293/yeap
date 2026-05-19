/**
 * Agent harness: wraps pi-agent-core's Agent with session persistence,
 * a message queue, and the correct model/tool configuration.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const SKILLET = process.env['SKILLET_PATH'] ?? '/skillet'
const SESSION_FILE = join(SKILLET, 'session.jsonl')
const AGENTS_FILE = join(SKILLET, 'AGENTS.md')

const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] ?? 'http://orchestrator:3000'
const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'

// ── Model resolution ──────────────────────────────────────────────────────────

type ModelConfig = {
  api: string
  provider: string
  id: string
  baseUrl?: string
  input: string[]
  reasoning: boolean
  contextWindow: number
  maxTokens: number
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

function buildModel(): ModelConfig {
  const modelRaw = process.env['BOT_MODEL'] ?? 'anthropic/claude-sonnet-4-20250514'
  const baseUrl = process.env['LLM_BASE_URL']

  const defaults = {
    input: ['text'] as string[],
    reasoning: false,
    contextWindow: 0,
    maxTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }

  if (baseUrl) {
    const id = modelRaw.includes('/') ? modelRaw.split('/').slice(1).join('/') : modelRaw
    return { api: 'openai-completions', provider: 'openai', id, baseUrl, ...defaults }
  }

  const slash = modelRaw.indexOf('/')
  const providerRaw = slash !== -1 ? modelRaw.slice(0, slash) : 'anthropic'
  const id = slash !== -1 ? modelRaw.slice(slash + 1) : modelRaw

  const apiMap: Record<string, string> = {
    anthropic: 'anthropic-messages',
    openai: 'openai-completions',
    google: 'google-generative-ai',
    mistral: 'mistral-conversations',
    bedrock: 'bedrock-converse-stream',
  }

  return { api: apiMap[providerRaw] ?? 'openai-completions', provider: providerRaw, id, ...defaults }
}

// ── Session persistence ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadSession(): any[] {
  if (!existsSync(SESSION_FILE)) return []
  const lines = readFileSync(SESSION_FILE, 'utf8').trim().split('\n').filter(Boolean)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = []
  for (const line of lines) {
    try {
      messages.push(JSON.parse(line))
    } catch {
      // skip corrupt lines
    }
  }
  return messages
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function saveSession(messages: any[]): void {
  try {
    if (messages.length === 0) {
      // Delete the session file so next restart treats this as a fresh start
      try { rmSync(SESSION_FILE) } catch { /* already gone */ }
      return
    }
    const lines = messages.map((m) => JSON.stringify(m)).join('\n')
    writeFileSync(SESSION_FILE, lines + '\n', 'utf8')
  } catch (err) {
    console.error('[session] Failed to save session:', err)
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

export function readSystemPrompt(): string {
  if (existsSync(AGENTS_FILE)) {
    return readFileSync(AGENTS_FILE, 'utf8')
  }
  const botName = process.env['BOT_NAME'] ?? 'Bot'
  const botRole = process.env['BOT_ROLE'] ?? 'A helpful assistant'
  return `# ${botName}\n\nYour role: ${botRole}\n\nYou communicate via Mattermost channels.`
}

// ── Message queue ─────────────────────────────────────────────────────────────

const pendingMessages: string[] = []
let processing = false
let compactNext = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let agentRef: any = null

export function enqueueMessage(text: string): void {
  pendingMessages.push(text)
  kickProcessor()
}

function kickProcessor(): void {
  if (processing || pendingMessages.length === 0 || !agentRef) return
  processing = true
  const text = pendingMessages.shift()!
  const isCompact = compactNext
  if (isCompact) compactNext = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(agentRef.prompt(text) as Promise<void>)
    .catch((err: unknown) => console.error('[agent] prompt error:', err))
    .finally(() => {
      if (isCompact && agentRef) {
        // Clear message history after compaction — LLM has written summary to memory.md
        console.log(`[agent] Compact run done — clearing session (was ${agentRef.state?.messages?.length ?? 0} messages)`)
        agentRef.state.messages = []
        saveSession([])
      }
      processing = false
      kickProcessor()
    })
}

// ── Agent factory ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createAgent(tools: any[]): Promise<any> {
  // Dynamic import so TypeScript doesn't need to fully resolve the pi-agent-core types at compile time
  const { Agent } = await import('@earendil-works/pi-agent-core')

  const systemPrompt = readSystemPrompt()
  const model = buildModel()
  const messages = loadSession()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent: any = new (Agent as any)({
    initialState: {
      systemPrompt,
      model,
      tools,
      messages,
    },
    // convertToLlm: pass messages through unchanged (no custom message types used)
    convertToLlm: (msgs: unknown[]) => msgs,
    getApiKey: async (provider: string) => {
      const upperProvider = provider.toUpperCase()
      return (
        process.env[`${upperProvider}_API_KEY`] ??
        process.env['LLM_API_KEY'] ??
        undefined
      )
    },
  })

  // Persist session after each agent run
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent.subscribe(async (event: any) => {
    if (event.type === 'agent_end') {
      const errMsg = event.messages?.[0]?.errorMessage
      if (errMsg) {
        console.error('[agent] LLM error:', errMsg)
      } else {
        console.log('[agent] run complete, messages:', agent.state?.messages?.length ?? 0)
      }
      saveSession(agent.state?.messages ?? [])
      // Notify orchestrator so it can track compaction pressure
      fetch(`${ORCHESTRATOR_URL}/spawn/compact-check/${encodeURIComponent(BOT_NAME)}`, { method: 'POST' })
        .catch(() => { /* best-effort */ })
    }
  })

  agentRef = agent
  return agent
}

/** Trigger a prompt on the agent. Safe to call externally. */
export function triggerPrompt(text: string): void {
  enqueueMessage(text)
}

/** Trigger a compact run: LLM summarises to memory.md, then session is cleared. */
export function triggerCompact(text: string): void {
  compactNext = true
  enqueueMessage(text)
}
