import { Type } from '@sinclair/typebox'
import type { TObject } from '@sinclair/typebox'
import {
  getChannelByName,
  postToChannel,
  getChannelPosts,
  getThread,
  searchPosts,
  listChannels,
} from '../mattermost.js'
import type { AgentTool } from '@earendil-works/pi-agent-core'

const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] ?? 'http://orchestrator:3000'

const postToChannelParams = Type.Object({
  channel_name: Type.String({ description: 'The channel name (e.g. "human", "inbox-alice")' }),
  content: Type.String({ description: 'The message content (Markdown supported)' }),
})

export const post_to_channel: AgentTool<typeof postToChannelParams> = {
  name: 'post_to_channel',
  label: 'Post to Channel',
  description:
    'Post a message to a Mattermost channel. Use this to send messages visible to the human or other bots.',
  parameters: postToChannelParams,
  execute: async (_id, params) => {
    const channel = await getChannelByName(params.channel_name)
    if (!channel) {
      return {
        content: [{ type: 'text' as const, text: `Channel '${params.channel_name}' not found. Use join_channel first if needed.` }],
        details: {},
      }
    }
    const postId = await postToChannel(channel.id, params.content)
    return {
      content: [{ type: 'text' as const, text: `Posted to #${params.channel_name} (post id: ${postId})` }],
      details: { post_id: postId, channel_id: channel.id },
    }
  },
}

const replyToPostParams = Type.Object({
  channel_name: Type.String({ description: 'The channel the original post is in' }),
  root_post_id: Type.String({ description: 'The ID of the post to reply to' }),
  content: Type.String({ description: 'The reply content' }),
})

export const reply_to_post: AgentTool<typeof replyToPostParams> = {
  name: 'reply_to_post',
  label: 'Reply to Post',
  description:
    'Reply to a specific Mattermost post (create a thread reply). Provide the channel name and the root post ID.',
  parameters: replyToPostParams,
  execute: async (_id, params) => {
    const channel = await getChannelByName(params.channel_name)
    if (!channel) {
      return {
        content: [{ type: 'text' as const, text: `Channel '${params.channel_name}' not found.` }],
        details: {},
      }
    }
    const postId = await postToChannel(channel.id, params.content, params.root_post_id)
    return {
      content: [{ type: 'text' as const, text: `Replied in thread (post id: ${postId})` }],
      details: { post_id: postId },
    }
  },
}

// ── Read / search tools ───────────────────────────────────────────────────────

const readChannelParams = Type.Object({
  channel_name: Type.String({ description: 'The channel name to read (e.g. "human", "general")' }),
  count: Type.Optional(Type.Number({ description: 'Number of recent messages to fetch (default 30, max 60)' })),
})

export const read_channel: AgentTool<typeof readChannelParams> = {
  name: 'read_channel',
  label: 'Read Channel',
  description:
    'Read recent messages from a Mattermost channel. Returns messages sorted oldest-first with timestamps and usernames. Use this to catch up on a conversation or review what was said.',
  parameters: readChannelParams,
  execute: async (_id, params) => {
    const channel = await getChannelByName(params.channel_name)
    if (!channel) {
      return {
        content: [{ type: 'text' as const, text: `Channel '${params.channel_name}' not found.` }],
        details: {},
      }
    }
    const perPage = Math.min(params.count ?? 30, 60)
    const { formatted } = await getChannelPosts(channel.id, perPage)
    const text = formatted || '(no messages found)'
    return {
      content: [{ type: 'text' as const, text: `#${params.channel_name} (last ${perPage} messages):\n\n${text}` }],
      details: { channel_id: channel.id },
    }
  },
}

const getThreadParams = Type.Object({
  root_post_id: Type.String({ description: 'The ID of the root post of the thread to read' }),
})

export const get_thread: AgentTool<typeof getThreadParams> = {
  name: 'get_thread',
  label: 'Get Thread',
  description:
    'Read all replies in a Mattermost thread by providing the root post ID. Use this to follow the full context of a threaded conversation.',
  parameters: getThreadParams,
  execute: async (_id, params) => {
    const { formatted } = await getThread(params.root_post_id)
    const text = formatted || '(no posts found)'
    return {
      content: [{ type: 'text' as const, text: `Thread ${params.root_post_id}:\n\n${text}` }],
      details: {},
    }
  },
}

const searchMessagesParams = Type.Object({
  query: Type.String({ description: 'Full-text search query. Supports Mattermost search syntax: @username, #channel, from:username, in:channel, before:date, after:date' }),
})

export const search_messages: AgentTool<typeof searchMessagesParams> = {
  name: 'search_messages',
  label: 'Search Messages',
  description:
    'Search for messages across all Mattermost channels using full-text search. Supports filters like from:@username, in:#channel, before:YYYY-MM-DD, after:YYYY-MM-DD.',
  parameters: searchMessagesParams,
  execute: async (_id, params) => {
    const { formatted } = await searchPosts(params.query)
    const text = formatted || '(no results)'
    return {
      content: [{ type: 'text' as const, text: `Search results for "${params.query}":\n\n${text}` }],
      details: {},
    }
  },
}

const listChannelsParams = Type.Object({})

export const list_channels: AgentTool<typeof listChannelsParams> = {
  name: 'list_channels',
  label: 'List Channels',
  description:
    'List all Mattermost channels the bot is a member of (or all public channels in the team). Shows channel names, display names, and types (O = public, P = private, D = direct).',
  parameters: listChannelsParams,
  execute: async (_id, _params) => {
    const channels = await listChannels()
    if (channels.length === 0) {
      return {
        content: [{ type: 'text' as const, text: 'No channels found.' }],
        details: {},
      }
    }
    const lines = channels.map(
      (c) => `#${c.name} (${c.display_name}) [${c.type === 'O' ? 'public' : c.type === 'P' ? 'private' : c.type}]`,
    )
    return {
      content: [{ type: 'text' as const, text: `Channels:\n${lines.join('\n')}` }],
      details: { count: channels.length },
    }
  },
}
