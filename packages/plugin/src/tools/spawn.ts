import { tool } from '@opencode-ai/plugin'
import type { SpawnResponse } from '@yeap/shared'

const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] ?? 'http://orchestrator:3000'
const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'

export const spawn_bot = tool({
  description:
    'Request the orchestrator to create a new specialist bot. Only call this when the human has explicitly asked for new capability. Do not spawn bots autonomously.',
  args: {
    name: tool.schema.string('Desired bot name. 2-32 chars, alphanumeric/spaces/hyphens.'),
    role: tool.schema.string('Clear description of what this bot does.'),
    model: tool.schema.string('LLM model string e.g. "anthropic/claude-sonnet-4-5".'),
  },
  async execute({ name, role, model }) {
    const res = await fetch(`${ORCHESTRATOR_URL}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requested_by: BOT_NAME, name, role, model }),
    })
    if (res.status === 409) return `A bot named '${name}' already exists.`
    if (!res.ok) {
      const body = (await res.json()) as { error?: string }
      return `Failed to spawn bot: ${body.error ?? res.statusText}`
    }
    const data = (await res.json()) as SpawnResponse
    return `Bot '${data.bot.name}' spawned successfully. It will come online shortly.`
  },
})
