/**
 * 01-smoke.test.ts
 *
 * Basic health checks: all services respond, Mattermost is set up.
 */
import { describe, it, expect } from 'vitest'
import { ORCHESTRATOR_URL, MATTERMOST_URL, REMINDER_URL, mmFetch, MM_ADMIN_TOKEN } from './helpers.js'

describe('Smoke – service health', () => {
  it('orchestrator /health responds 200', async () => {
    const res = await fetch(`${ORCHESTRATOR_URL}/health`)
    expect(res.status).toBe(200)
  })

  it('orchestrator /setup/status returns initialized: true', async () => {
    const res = await fetch(`${ORCHESTRATOR_URL}/setup/status`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { initialized: boolean }
    expect(body.initialized).toBe(true)
  })

  it('reminder service /health responds 200', async () => {
    const res = await fetch(`${REMINDER_URL}/health`)
    expect(res.status).toBe(200)
  })

  it('Mattermost /api/v4/system/ping responds OK', async () => {
    const res = await fetch(`${MATTERMOST_URL}/api/v4/system/ping`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('OK')
  })

  it('MM admin token is valid', async () => {
    expect(MM_ADMIN_TOKEN, 'MM_ADMIN_TOKEN env must be set').toBeTruthy()
    const res = await mmFetch('/users/me')
    expect(res.status).toBe(200)
    const user = (await res.json()) as { username: string }
    expect(user.username).toBeTruthy()
    console.log(`Authenticated as MM user: ${user.username}`)
  })

  it('yeap team exists in Mattermost', async () => {
    const res = await mmFetch('/teams/name/yeap')
    expect(res.status).toBe(200)
  })

  it('human channel exists in yeap team', async () => {
    const teamRes = await mmFetch('/teams/name/yeap')
    const team = (await teamRes.json()) as { id: string }
    const chRes = await mmFetch(`/teams/${team.id}/channels/name/human`)
    expect(chRes.status).toBe(200)
  })
})
