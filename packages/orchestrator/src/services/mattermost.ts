/**
 * Mattermost REST API helpers used by the orchestrator.
 * All calls are internal (container network) via MATTERMOST_URL.
 */

export const MM_URL = process.env['MATTERMOST_URL'] ?? 'http://mattermost:8065'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function mmFetch(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<Response> {
  const { token, ...fetchOptions } = options
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string> | undefined),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return fetch(`${MM_URL}${path}`, { ...fetchOptions, headers })
}

/** Wait for Mattermost to respond with a healthy ping. */
export async function waitForMattermost(maxRetries = 60, delayMs = 3000): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${MM_URL}/api/v4/system/ping`)
      if (res.ok) {
        const data = (await res.json()) as { status?: string }
        if (data.status === 'OK') return
      }
    } catch {
      // not ready yet
    }
    await sleep(delayMs)
  }
  throw new Error(`Mattermost not ready after ${maxRetries} attempts`)
}

/** Create the first admin user. The first user on a fresh Mattermost instance gets system_admin. */
export async function createAdminUser(
  email: string,
  username: string,
  password: string,
): Promise<{ user_id: string; token: string }> {
  const res = await mmFetch('/api/v4/users', {
    method: 'POST',
    body: JSON.stringify({ email, username, password }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to create admin user: ${res.status} ${text}`)
  }
  const user = (await res.json()) as { id: string }
  const token = await loginUser(email, password)
  return { user_id: user.id, token }
}

/** Log in as an existing user, returning the session token. */
export async function loginUser(loginId: string, password: string): Promise<string> {
  const res = await mmFetch('/api/v4/users/login', {
    method: 'POST',
    body: JSON.stringify({ login_id: loginId, password }),
  })
  if (!res.ok) throw new Error(`Mattermost login failed: ${res.status}`)
  const token = res.headers.get('Token') ?? res.headers.get('token')
  if (!token) throw new Error('No token in Mattermost login response')
  return token
}

/** Create a team. type: 'I' = invite-only, 'O' = open. */
export async function createTeam(
  name: string,
  displayName: string,
  token: string,
  type: 'I' | 'O' = 'I',
): Promise<{ id: string }> {
  const res = await mmFetch('/api/v4/teams', {
    method: 'POST',
    token,
    body: JSON.stringify({ name, display_name: displayName, type }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to create team: ${res.status} ${text}`)
  }
  return (await res.json()) as { id: string }
}

/** Create a Mattermost bot account plus a personal access token, add to team. */
export async function createBotUser(
  username: string,
  displayName: string,
  description: string,
  adminToken: string,
  teamId: string,
): Promise<{ user_id: string; token: string }> {
  const botRes = await mmFetch('/api/v4/bots', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({ username, display_name: displayName, description }),
  })
  if (!botRes.ok) {
    const text = await botRes.text()
    throw new Error(`Failed to create MM bot ${username}: ${botRes.status} ${text}`)
  }
  const bot = (await botRes.json()) as { user_id: string }
  const userId = bot.user_id

  const tokenRes = await mmFetch(`/api/v4/users/${userId}/tokens`, {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({ description: `yeap-token-${username}` }),
  })
  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    throw new Error(`Failed to create MM token for ${username}: ${tokenRes.status} ${text}`)
  }
  const tokenData = (await tokenRes.json()) as { token: string }

  await addTeamMember(teamId, userId, adminToken)

  return { user_id: userId, token: tokenData.token }
}

/** Disable a bot account. */
export async function disableBotUser(userId: string, adminToken: string): Promise<void> {
  await mmFetch(`/api/v4/bots/${userId}/disable`, {
    method: 'POST',
    token: adminToken,
  })
}

/** Add a user to a team (idempotent). */
export async function addTeamMember(
  teamId: string,
  userId: string,
  adminToken: string,
): Promise<void> {
  const res = await mmFetch(`/api/v4/teams/${teamId}/members`, {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({ team_id: teamId, user_id: userId }),
  })
  if (!res.ok) {
    const text = await res.text()
    // 400 with "already a member" is fine
    if (res.status === 400 && text.includes('already')) return
    throw new Error(`Failed to add team member: ${res.status} ${text}`)
  }
}

/** Create a channel, return its id. type: 'O' = public, 'P' = private. */
export async function createChannel(
  teamId: string,
  name: string,
  displayName: string,
  type: 'O' | 'P',
  adminToken: string,
): Promise<{ id: string }> {
  const res = await mmFetch('/api/v4/channels', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({ team_id: teamId, name, display_name: displayName, type }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to create channel ${name}: ${res.status} ${text}`)
  }
  return (await res.json()) as { id: string }
}

/** Get a channel by name, or create it if absent. Restores soft-deleted channels. */
export async function getOrCreateChannel(
  teamId: string,
  name: string,
  displayName: string,
  type: 'O' | 'P',
  adminToken: string,
): Promise<{ id: string }> {
  const getRes = await mmFetch(
    `/api/v4/teams/${teamId}/channels/name/${encodeURIComponent(name)}`,
    { token: adminToken },
  )
  if (getRes.ok) {
    const channel = (await getRes.json()) as { id: string; delete_at: number }
    if (channel.delete_at && channel.delete_at > 0) {
      // Channel is soft-deleted — restore it
      await mmFetch(`/api/v4/channels/${channel.id}/restore`, { method: 'POST', token: adminToken })
    }
    return channel
  }
  return createChannel(teamId, name, displayName, type, adminToken)
}

/** Get a channel by name, returning null if not found. */
export async function getChannelByName(
  teamId: string,
  channelName: string,
  token: string,
): Promise<{ id: string } | null> {
  const res = await mmFetch(
    `/api/v4/teams/${teamId}/channels/name/${encodeURIComponent(channelName)}`,
    { token },
  )
  if (!res.ok) return null
  return (await res.json()) as { id: string }
}

/** Add a user to a channel (idempotent). */
export async function addChannelMember(
  channelId: string,
  userId: string,
  adminToken: string,
): Promise<void> {
  const res = await mmFetch(`/api/v4/channels/${channelId}/members`, {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({ user_id: userId }),
  })
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 400 && text.includes('already')) return
    throw new Error(`Failed to add channel member: ${res.status} ${text}`)
  }
}

/** Remove a user from a channel. */
export async function removeChannelMember(
  channelId: string,
  userId: string,
  adminToken: string,
): Promise<void> {
  await mmFetch(`/api/v4/channels/${channelId}/members/${userId}`, {
    method: 'DELETE',
    token: adminToken,
  })
}

/** Post a message to a channel. Returns the created post's id. */
export async function postMessage(
  channelId: string,
  message: string,
  token: string,
  rootId?: string,
): Promise<{ id: string }> {
  const body: Record<string, string> = { channel_id: channelId, message }
  if (rootId) body['root_id'] = rootId
  const res = await mmFetch('/api/v4/posts', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to post MM message: ${res.status} ${text}`)
  }
  return (await res.json()) as { id: string }
}

/** Get all channels a user belongs to in a team. */
export async function getUserChannels(
  teamId: string,
  userId: string,
  token: string,
): Promise<Array<{ id: string; name: string }>> {
  const res = await mmFetch(`/api/v4/users/${userId}/teams/${teamId}/channels`, { token })
  if (!res.ok) return []
  return (await res.json()) as Array<{ id: string; name: string }>
}

/** Get a single post by ID. */
export async function getPost(
  postId: string,
  token: string,
): Promise<{ id: string; channel_id: string; root_id: string } | null> {
  const res = await mmFetch(`/api/v4/posts/${encodeURIComponent(postId)}`, { token })
  if (!res.ok) return null
  return (await res.json()) as { id: string; channel_id: string; root_id: string }
}

/** Update the SiteURL in Mattermost's service settings. */
export async function updateSiteUrl(siteUrl: string, adminToken: string): Promise<void> {
  await mmFetch('/api/v4/config/patch', {
    method: 'PUT',
    token: adminToken,
    body: JSON.stringify({ ServiceSettings: { SiteURL: siteUrl } }),
  })
}
