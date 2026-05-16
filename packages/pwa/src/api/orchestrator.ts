import { useAuthStore } from '../store/auth.js'
import type {
  Bot,
  LoginPayload,
  LoginResponse,
  SetupInitPayload,
  SetupStatus,
} from '@yeap/shared'

export type FileEntry = { name: string; type: 'file' | 'dir'; size: number }

const BASE = import.meta.env['VITE_ORCHESTRATOR_URL'] ?? '/api/orch'

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...init, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new ApiError(res.status, body.error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export async function getSetupStatus(): Promise<SetupStatus> {
  return req<SetupStatus>('/setup/status')
}

export async function postSetupInit(payload: SetupInitPayload): Promise<{ ok: boolean }> {
  return req<{ ok: boolean }>('/setup/init', { method: 'POST', body: JSON.stringify(payload) })
}

export async function postLogin(payload: LoginPayload): Promise<LoginResponse> {
  return req<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(payload) })
}

export async function getBots(topic?: string): Promise<Bot[]> {
  const qs = topic ? `?topic=${encodeURIComponent(topic)}` : ''
  return req<Bot[]>(`/registry/bots${qs}`)
}

export async function subscribeBot(bot_name: string, topic_id: string): Promise<void> {
  await req<{ ok: boolean }>('/registry/subscribe', {
    method: 'POST',
    body: JSON.stringify({ bot_name, topic_id }),
  })
}

export async function unsubscribeBot(bot_name: string, topic_id: string): Promise<void> {
  await req<{ ok: boolean }>('/registry/subscribe', {
    method: 'DELETE',
    body: JSON.stringify({ bot_name, topic_id }),
  })
}

export async function listVirtualFiles(path: string): Promise<FileEntry[]> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : ''
  const data = await req<{ entries: FileEntry[] }>(`/pwa/files/ls${qs}`)
  return data.entries ?? []
}

export async function readVirtualFile(path: string): Promise<string> {
  const data = await req<{ content: string }>(`/pwa/files/read?path=${encodeURIComponent(path)}`)
  return data.content ?? ''
}

export async function resetBot(name: string): Promise<void> {
  await req<{ ok: boolean }>(`/spawn/reset/${encodeURIComponent(name)}`, { method: 'POST' })
}

export async function compactBot(name: string): Promise<void> {
  await req<{ ok: boolean }>(`/spawn/compact/${encodeURIComponent(name)}`, { method: 'POST' })
}
