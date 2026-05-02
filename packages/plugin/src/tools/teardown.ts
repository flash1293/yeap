import { tool } from '@opencode-ai/plugin'

const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] ?? 'http://orchestrator:3000'

export const teardown_bot = tool({
  description:
    'Stop and permanently remove a bot. The bot\'s container is destroyed and it is removed from the registry. ' +
    'Its /skillet volume (memory, session) is preserved. Only call this when the human has explicitly asked to remove a bot.',
  args: {
    name: tool.schema.string('Exact name of the bot to tear down.'),
  },
  async execute({ name }) {
    const res = await fetch(`${ORCHESTRATOR_URL}/spawn/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    })
    if (res.status === 404) return `No bot named '${name}' found.`
    if (res.status === 403) return `Cannot tear down the coordinator.`
    if (!res.ok) {
      const body = (await res.json()) as { error?: string }
      return `Failed to tear down bot: ${body.error ?? res.statusText}`
    }
    return `Bot '${name}' has been stopped and removed.`
  },
})
