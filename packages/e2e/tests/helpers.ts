/**
 * Shared test helpers for the yeap E2E suite.
 *
 * Environment variables expected (with docker-compose defaults):
 *   ORCHESTRATOR_URL   http://localhost:3000   (or via Caddy: https://<domain>/api/orch)
 *   MATTERMOST_URL     http://localhost:8065
 *   REMINDER_URL       http://localhost:3001
 *   MM_ADMIN_TOKEN     Mattermost admin PAT
 *   MM_TEAM_NAME       yeap
 */

import type { Bot } from '@yeap/shared'

export const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] ?? 'http://localhost:3000'
export const MATTERMOST_URL = process.env['MATTERMOST_URL'] ?? 'http://localhost:8065'
export const REMINDER_URL = process.env['REMINDER_URL'] ?? 'http://localhost:3001'
export const MM_ADMIN_TOKEN = process.env['MM_ADMIN_TOKEN'] ?? ''
export const MM_TEAM_NAME = process.env['MM_TEAM_NAME'] ?? 'yeap'

/** Mattermost REST request with admin token */
export async function mmFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${MATTERMOST_URL}/api/v4${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${MM_ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
}

/** Orchestrator REST request */
export async function orchFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = process.env['ORCH_TOKEN'] ?? ''
  return fetch(`${ORCHESTRATOR_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
}

export interface MmPost {
  id: string
  channel_id: string
  user_id: string
  message: string
  root_id: string
  create_at: number
}

export interface MmUser {
  id: string
  username: string
  email: string
}

/** Poll until a post matching the predicate appears in the channel. */
export async function waitForPost(
  channelId: string,
  predicate: {
    authorUsername?: string
    containsText?: string
    timeoutMs?: number
    afterMs?: number
  },
): Promise<MmPost> {
  const deadline = Date.now() + (predicate.timeoutMs ?? 60_000)
  const since = predicate.afterMs ?? Date.now() - 5_000

  while (Date.now() < deadline) {
    const res = await mmFetch(`/channels/${channelId}/posts?since=${since}&per_page=60`)
    if (res.ok) {
      const data = (await res.json()) as { order: string[]; posts: Record<string, MmPost> }
      for (const id of data.order ?? []) {
        const post = data.posts[id]!
        if (predicate.containsText && !post.message.includes(predicate.containsText)) continue
        if (predicate.authorUsername) {
          const userRes = await mmFetch(`/users/${post.user_id}`)
          if (userRes.ok) {
            const user = (await userRes.json()) as MmUser
            if (user.username !== predicate.authorUsername) continue
          }
        }
        return post
      }
    }
    await sleep(3000)
  }
  throw new Error(
    `waitForPost timed out after ${predicate.timeoutMs ?? 60_000}ms in channel ${channelId} (looking for: ${JSON.stringify(predicate)})`,
  )
}

/** Poll orchestrator registry until bot appears with 'online' status. */
export async function waitForBotOnline(botName: string, timeoutMs = 90_000): Promise<Bot> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await orchFetch('/registry/bots')
    if (res.ok) {
      const bots = (await res.json()) as Bot[]
      const bot = bots.find((b) => b.name === botName)
      if (bot?.status === 'online') return bot
    }
    await sleep(5000)
  }
  throw new Error(`Bot '${botName}' did not come online within ${timeoutMs}ms`)
}

/** Get (or cache) the team ID for MM_TEAM_NAME */
let cachedTeamId: string | undefined
export async function getTeamId(): Promise<string> {
  if (cachedTeamId) return cachedTeamId
  const res = await mmFetch(`/teams/name/${MM_TEAM_NAME}`)
  if (!res.ok) throw new Error(`Could not get team '${MM_TEAM_NAME}': ${res.status}`)
  const team = (await res.json()) as { id: string }
  cachedTeamId = team.id
  return team.id
}

/** Get or create a channel by name in the yeap team. */
export async function getChannelId(channelName: string): Promise<string> {
  const teamId = await getTeamId()
  const res = await mmFetch(`/teams/${teamId}/channels/name/${channelName}`)
  if (res.ok) {
    const ch = (await res.json()) as { id: string }
    return ch.id
  }
  throw new Error(`Channel '${channelName}' not found: ${res.status}`)
}

/** Post a message to a channel as the admin user (for test stimulus). */
export async function postAsAdmin(channelId: string, message: string, rootId?: string): Promise<MmPost> {
  const res = await mmFetch('/posts', {
    method: 'POST',
    body: JSON.stringify({ channel_id: channelId, message, root_id: rootId ?? '' }),
  })
  if (!res.ok) throw new Error(`Failed to post message: ${res.status}`)
  return res.json() as Promise<MmPost>
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
