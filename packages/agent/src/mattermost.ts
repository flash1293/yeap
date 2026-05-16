/**
 * Mattermost REST + WebSocket client for bot agents.
 */
import WebSocket from 'ws'

const MM_URL = process.env['MATTERMOST_URL'] ?? 'http://mattermost:8065'
const MM_TOKEN = process.env['MATTERMOST_TOKEN'] ?? ''
const MM_USER_ID = process.env['MATTERMOST_USER_ID'] ?? ''
const MM_TEAM_ID_ENV = process.env['MATTERMOST_TEAM_ID'] ?? ''

export type MMPost = {
  id: string
  channel_id: string
  channel_name?: string
  user_id: string
  message: string
  root_id: string
  create_at: number
}

type MMPostList = {
  order: string[]
  posts: Record<string, MMPost>
}

// Simple in-process username cache to avoid repeated API calls
const _userCache = new Map<string, string>()

async function resolveUsername(userId: string): Promise<string> {
  if (_userCache.has(userId)) return _userCache.get(userId)!
  const res = await mmFetch(`/api/v4/users/${userId}`)
  if (!res.ok) return userId
  const user = (await res.json()) as { username: string }
  _userCache.set(userId, user.username)
  return user.username
}

async function mmFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${MM_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MM_TOKEN}`,
      ...(options.headers as Record<string, string> | undefined),
    },
  })
}

/** Post a message to a channel. Returns post id. */
export async function postToChannel(channelId: string, message: string, rootId?: string): Promise<string> {
  const body: Record<string, string> = { channel_id: channelId, message }
  if (rootId) body['root_id'] = rootId
  const res = await mmFetch('/api/v4/posts', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to post to channel ${channelId}: ${res.status} ${text}`)
  }
  const post = (await res.json()) as { id: string }
  return post.id
}

/** Get channel by name in the bot's team. */
export async function getChannelByName(channelName: string): Promise<{ id: string; name: string } | null> {
  const teamId = await getTeamId()
  if (!teamId) return null
  const res = await mmFetch(`/api/v4/teams/${teamId}/channels/name/${encodeURIComponent(channelName)}`)
  if (!res.ok) return null
  return (await res.json()) as { id: string; name: string }
}

/** Join (add self to) a channel by name. */
export async function joinChannel(channelName: string): Promise<void> {
  const teamId = await getTeamId()
  if (!teamId) throw new Error('No team ID configured')
  const channel = await getChannelByName(channelName)
  if (!channel) throw new Error(`Channel '${channelName}' not found`)
  const res = await mmFetch(`/api/v4/channels/${channel.id}/members`, {
    method: 'POST',
    body: JSON.stringify({ user_id: MM_USER_ID }),
  })
  if (!res.ok && res.status !== 400) {
    const t = await res.text()
    if (!t.includes('already')) throw new Error(`Failed to join channel: ${res.status} ${t}`)
  }
}

/** Leave a channel by name. */
export async function leaveChannel(channelName: string): Promise<void> {
  const channel = await getChannelByName(channelName)
  if (!channel) return
  await mmFetch(`/api/v4/channels/${channel.id}/members/${MM_USER_ID}`, { method: 'DELETE' })
}

/** Get the team ID (from env or fetched). */
let _teamId: string | null = MM_TEAM_ID_ENV || null

export async function getTeamId(): Promise<string | null> {
  if (_teamId) return _teamId
  // Look up first team the bot is in
  const res = await mmFetch(`/api/v4/users/${MM_USER_ID}/teams`)
  if (!res.ok) return null
  const teams = (await res.json()) as Array<{ id: string; name: string }>
  _teamId = teams[0]?.id ?? null
  return _teamId
}

/** Format a list of posts as readable text (oldest first). */
async function formatPosts(posts: MMPost[]): Promise<string> {
  const sorted = [...posts].sort((a, b) => a.create_at - b.create_at)
  const lines: string[] = []
  for (const p of sorted) {
    const name = await resolveUsername(p.user_id)
    const ts = new Date(p.create_at).toISOString().slice(0, 16).replace('T', ' ')
    const thread = p.root_id ? ` (thread)` : ''
    lines.push(`[${ts}${thread}] @${name} (${p.id}): ${p.message}`)
  }
  return lines.join('\n')
}

/**
 * Get recent posts from a channel.
 * Returns posts sorted oldest-first.
 */
export async function getChannelPosts(channelId: string, perPage = 30): Promise<{ posts: MMPost[]; formatted: string }> {
  const res = await mmFetch(`/api/v4/channels/${channelId}/posts?page=0&per_page=${perPage}`)
  if (!res.ok) throw new Error(`Failed to get channel posts: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as MMPostList
  const posts = (data.order ?? []).map((id) => data.posts[id]!).filter(Boolean)
  return { posts, formatted: await formatPosts(posts) }
}

/**
 * Get all posts in a thread by the root post id.
 */
export async function getThread(rootPostId: string): Promise<{ posts: MMPost[]; formatted: string }> {
  const res = await mmFetch(`/api/v4/posts/${rootPostId}/thread`)
  if (!res.ok) throw new Error(`Failed to get thread: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as MMPostList
  const posts = (data.order ?? []).map((id) => data.posts[id]!).filter(Boolean)
  return { posts, formatted: await formatPosts(posts) }
}

/**
 * Search posts across the team using Mattermost full-text search.
 */
export async function searchPosts(query: string): Promise<{ posts: MMPost[]; formatted: string }> {
  const teamId = await getTeamId()
  if (!teamId) return { posts: [], formatted: 'No team available.' }
  const res = await mmFetch(`/api/v4/teams/${teamId}/posts/search`, {
    method: 'POST',
    body: JSON.stringify({ terms: query, is_or_search: false, page: 0, per_page: 20 }),
  })
  if (!res.ok) return { posts: [], formatted: `Search failed: ${res.status}` }
  const data = (await res.json()) as MMPostList
  const posts = (data.order ?? []).map((id) => data.posts[id]!).filter(Boolean)
  return { posts, formatted: await formatPosts(posts) }
}

/**
 * List all channels in the team the bot has access to.
 */
export async function listChannels(): Promise<Array<{ id: string; name: string; display_name: string; type: string }>> {
  const teamId = await getTeamId()
  if (!teamId) return []
  // Get channels the bot is a member of
  const memberRes = await mmFetch(`/api/v4/users/${MM_USER_ID}/teams/${teamId}/channels`)
  if (memberRes.ok) {
    return (await memberRes.json()) as Array<{ id: string; name: string; display_name: string; type: string }>
  }
  // Fallback: all public channels
  const res = await mmFetch(`/api/v4/teams/${teamId}/channels?page=0&per_page=100`)
  if (!res.ok) return []
  return (await res.json()) as Array<{ id: string; name: string; display_name: string; type: string }>
}

export type MMPostHandler = (post: MMPost) => void

/** Connect to Mattermost WebSocket and call handler on new posts not from self. */
export function startMattermostWebSocket(onPost: MMPostHandler): WebSocket {
  const wsUrl = MM_URL.replace(/^http/, 'ws') + '/api/v4/websocket'
  const ws = new WebSocket(wsUrl)

  ws.on('open', () => {
    console.log('[mm-ws] Connected to Mattermost WebSocket')
    // Authenticate
    ws.send(JSON.stringify({
      seq: 1,
      action: 'authentication_challenge',
      data: { token: MM_TOKEN },
    }))
  })

  ws.on('message', (rawData: WebSocket.RawData) => {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(rawData.toString()) as Record<string, unknown>
    } catch {
      return
    }

    if (msg['event'] !== 'posted') return

    const data = msg['data'] as Record<string, unknown> | undefined
    if (!data) return

    let post: MMPost
    try {
      post = JSON.parse(data['post'] as string) as MMPost
    } catch {
      return
    }

    // Skip own posts
    if (post.user_id === MM_USER_ID) return

    // Attach channel_name from the WS event data (available in posted events)
    if (data['channel_name']) {
      post.channel_name = data['channel_name'] as string
    }

    onPost(post)
  })

  ws.on('error', (err) => {
    console.error('[mm-ws] WebSocket error:', err)
  })

  ws.on('close', () => {
    console.log('[mm-ws] WebSocket closed, reconnecting in 5s...')
    setTimeout(() => startMattermostWebSocket(onPost), 5000)
  })

  return ws
}
