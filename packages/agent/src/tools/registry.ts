import { Type } from '@sinclair/typebox'
import { joinChannel, leaveChannel } from '../mattermost.js'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { Bot } from '@yeap/shared'

const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] ?? 'http://orchestrator:3000'
const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'

const queryBotsParams = Type.Object({
  channel_name: Type.Optional(Type.String({ description: 'Filter to bots subscribed to this channel' })),
})
export const query_bots: AgentTool<typeof queryBotsParams> = {
  name: 'query_bots',
  label: 'Query Bots',
  description: 'List all known bots in the YEAP registry, with their names, roles, and statuses.',
  parameters: queryBotsParams,
  execute: async (_id, params) => {
    const url = new URL(`${ORCHESTRATOR_URL}/registry/bots`)
    if (params.channel_name) url.searchParams.set('topic', params.channel_name)
    const res = await fetch(url)
    const bots = (await res.json()) as Bot[]
    if (!bots.length) return { content: [{ type: 'text' as const, text: 'No bots found.' }], details: {} }
    const lines = bots.map((b) => `**${b.name}** (${b.status}) — ${b.role_description}`).join('\n')
    return { content: [{ type: 'text' as const, text: lines }], details: {} }
  },
}

const updateStatusParams = Type.Object({
  status: Type.String({ description: "Exactly one of: 'online', 'offline', 'busy'" }),
})
export const update_status: AgentTool<typeof updateStatusParams> = {
  name: 'update_status',
  label: 'Update Status',
  description: "Update this bot's status. Use 'online', 'offline', or 'busy'.",
  parameters: updateStatusParams,
  execute: async (_id, params) => {
    await fetch(`${ORCHESTRATOR_URL}/registry/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: BOT_NAME, status: params.status }),
    })
    return { content: [{ type: 'text' as const, text: `Status updated to: ${params.status}` }], details: {} }
  },
}

const joinChannelParams = Type.Object({
  channel_name: Type.String({ description: 'Channel name to join' }),
})
export const join_channel: AgentTool<typeof joinChannelParams> = {
  name: 'join_channel',
  label: 'Join Channel',
  description: 'Join a Mattermost channel to start receiving messages from it.',
  parameters: joinChannelParams,
  execute: async (_id, params) => {
    await joinChannel(params.channel_name)
    await fetch(`${ORCHESTRATOR_URL}/registry/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_name: BOT_NAME, topic_id: params.channel_name }),
    })
    return { content: [{ type: 'text' as const, text: `Joined channel '${params.channel_name}'` }], details: {} }
  },
}

const leaveChannelParams = Type.Object({
  channel_name: Type.String({ description: 'Channel name to leave' }),
})
export const leave_channel: AgentTool<typeof leaveChannelParams> = {
  name: 'leave_channel',
  label: 'Leave Channel',
  description: 'Leave a Mattermost channel.',
  parameters: leaveChannelParams,
  execute: async (_id, params) => {
    await leaveChannel(params.channel_name)
    await fetch(`${ORCHESTRATOR_URL}/registry/subscribe`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_name: BOT_NAME, topic_id: params.channel_name }),
    })
    return { content: [{ type: 'text' as const, text: `Left channel '${params.channel_name}'` }], details: {} }
  },
}

const spawnBotParams = Type.Object({
  name: Type.String({ description: 'Bot name (2-32 chars, alphanumeric/spaces/hyphens)' }),
  role: Type.String({ description: 'Clear description of what this bot does' }),
  model: Type.String({ description: 'LLM model string e.g. "anthropic/claude-sonnet-4-5"' }),
})
export const spawn_bot: AgentTool<typeof spawnBotParams> = {
  name: 'spawn_bot',
  label: 'Spawn Bot',
  description: 'Request the orchestrator to create a new specialist bot. Only call this when the human has explicitly asked for new capability.',
  parameters: spawnBotParams,
  execute: async (_id, params) => {
    const res = await fetch(`${ORCHESTRATOR_URL}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requested_by: BOT_NAME, name: params.name, role: params.role, model: params.model }),
    })
    if (res.status === 409) return { content: [{ type: 'text' as const, text: `A bot named '${params.name}' already exists.` }], details: {} }
    if (!res.ok) {
      const body = (await res.json()) as { error?: string }
      return { content: [{ type: 'text' as const, text: `Failed to spawn bot: ${body.error ?? res.statusText}` }], details: {} }
    }
    return { content: [{ type: 'text' as const, text: `Bot '${params.name}' spawned successfully.` }], details: {} }
  },
}

const teardownBotParams = Type.Object({
  name: Type.String({ description: 'Exact name of the bot to tear down' }),
})
export const teardown_bot: AgentTool<typeof teardownBotParams> = {
  name: 'teardown_bot',
  label: 'Teardown Bot',
  description: 'Stop and permanently remove a bot. Only call this when the human has explicitly asked to remove a bot.',
  parameters: teardownBotParams,
  execute: async (_id, params) => {
    const res = await fetch(`${ORCHESTRATOR_URL}/spawn/${encodeURIComponent(params.name)}`, { method: 'DELETE' })
    if (res.status === 404) return { content: [{ type: 'text' as const, text: `No bot named '${params.name}' found.` }], details: {} }
    if (res.status === 403) return { content: [{ type: 'text' as const, text: 'Cannot tear down the coordinator.' }], details: {} }
    if (!res.ok) {
      const body = (await res.json()) as { error?: string }
      return { content: [{ type: 'text' as const, text: `Failed: ${body.error ?? res.statusText}` }], details: {} }
    }
    return { content: [{ type: 'text' as const, text: `Bot '${params.name}' has been stopped and removed.` }], details: {} }
  },
}
