import { tool } from '@opencode-ai/plugin'

const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] ?? 'http://orchestrator:3000'
const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'

export const request_compaction = tool({
  description:
    'Request the platform to compact this bot\'s conversation context. ' +
    'Call this when you have finished a block of work, memory.md is up to date, ' +
    'and you want to reduce context cruft before the next task. ' +
    'The platform will send the /compact command to your session.',
  args: {},
  async execute() {
    try {
      const res = await fetch(
        `${ORCHESTRATOR_URL}/spawn/compact/${encodeURIComponent(BOT_NAME)}`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        return `Compaction request failed: ${body.error ?? res.status}`
      }
      return 'Compaction requested. The platform will compact this session shortly.'
    } catch (err) {
      return `Compaction request failed: ${String(err)}`
    }
  },
})
