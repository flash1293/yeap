/**
 * 03-messaging.test.ts
 *
 * Coordinator messaging: posting in human channel, bot replies in thread.
 * Requires the coordinator to already be online (from setup).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  orchFetch,
  getChannelId,
  postAsAdmin,
  waitForPost,
  sleep,
} from './helpers.js'
import type { Bot } from '@yeap/shared'

let coordinatorUsername: string | undefined

beforeAll(async () => {
  const res = await orchFetch('/registry/bots')
  if (res.ok) {
    const bots = (await res.json()) as Bot[]
    const coord = bots.find((b) => b.is_coordinator && b.status === 'online')
    coordinatorUsername = coord?.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    console.log(`Coordinator MM username: ${coordinatorUsername}`)
  }
})

describe('Messaging — human channel', () => {
  it('coordinator is online', async () => {
    const res = await orchFetch('/registry/bots')
    expect(res.status).toBe(200)
    const bots = (await res.json()) as Bot[]
    const coord = bots.find((b) => b.is_coordinator)
    expect(coord, 'Coordinator not found in registry').toBeTruthy()
    expect(coord!.status).toBe('online')
  })

  it('posting in human channel triggers coordinator reply within 60s', async () => {
    const humanChannelId = await getChannelId('human')
    const marker = `ping-${Date.now()}`
    const startMs = Date.now()

    const triggerPost = await postAsAdmin(humanChannelId, `E2E test — please respond with "pong". Token: ${marker}`)
    console.log(`Posted trigger message id: ${triggerPost.id}`)

    // Wait for any reply in the thread from a non-admin user
    const reply = await waitForPost(humanChannelId, {
      containsText: 'pong',
      timeoutMs: 90_000,
      afterMs: startMs,
    })
    expect(reply.message.toLowerCase()).toContain('pong')
    console.log(`Got reply: "${reply.message.slice(0, 100)}"`)
  })

  it('/internal/notify posts to a channel', async () => {
    const channelId = await getChannelId('human')
    const marker = `notify-test-${Date.now()}`
    const startMs = Date.now()

    const res = await fetch(`${process.env['ORCHESTRATOR_URL'] ?? 'http://localhost:3000'}/internal/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_name: 'human', content: marker }),
    })
    expect(res.status).toBe(200)

    const post = await waitForPost(channelId, {
      containsText: marker,
      timeoutMs: 10_000,
      afterMs: startMs,
    })
    expect(post.message).toContain(marker)
  })
})

describe('Messaging — webhook', () => {
  it('POST /api/webhook/:channel posts to MM channel', async () => {
    const channelName = 'human'
    const channelId = await getChannelId(channelName)
    const marker = `webhook-${Date.now()}`
    const startMs = Date.now()

    const res = await fetch(
      `${process.env['ORCHESTRATOR_URL'] ?? 'http://localhost:3000'}/api/webhook/${channelName}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: marker, source: 'e2e-test' }),
      },
    )
    expect(res.status).toBe(204)

    const post = await waitForPost(channelId, {
      containsText: marker,
      timeoutMs: 15_000,
      afterMs: startMs,
    })
    expect(post.message).toContain(marker)
  })
})

describe('Messaging — channel join/leave', () => {
  it('coordinator can join and post to a new channel', async () => {
    // Create a temp channel via MM API to test cross-channel posting
    const { mmFetch, getTeamId } = await import('./helpers.js')
    const teamId = await getTeamId()
    const channelName = `e2e-tmp-${Date.now()}`

    const createRes = await mmFetch('/channels', {
      method: 'POST',
      body: JSON.stringify({
        team_id: teamId,
        name: channelName,
        display_name: `E2E Temp ${Date.now()}`,
        type: 'O', // open
      }),
    })
    expect(createRes.status).toBe(201)
    const channel = (await createRes.json()) as { id: string }
    console.log(`Created temp channel: ${channelName}`)

    await sleep(2000)

    // Ask coordinator to join and post there
    const humanChannelId = await getChannelId('human')
    const startMs = Date.now()
    await postAsAdmin(
      humanChannelId,
      `Please join the channel #${channelName} and post "hello from coordinator" there. This is an E2E test.`,
    )

    // Wait for the post to appear in the temp channel
    const post = await waitForPost(channel.id, {
      containsText: 'hello',
      timeoutMs: 90_000,
      afterMs: startMs,
    })
    expect(post.message.toLowerCase()).toContain('hello')
    console.log(`Coordinator posted in ${channelName}: "${post.message.slice(0, 80)}"`)

    // Archive temp channel
    await mmFetch(`/channels/${channel.id}`, { method: 'DELETE' })
  })
})
