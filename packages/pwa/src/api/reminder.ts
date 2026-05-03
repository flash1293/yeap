import type { FsadEvent, FileNode, FileContentResponse, FsadMessage, Reminder } from '@yeap/shared'

const BASE = import.meta.env['VITE_REMINDER_URL'] ?? '/api/rem'

export function subscribeEvents(
  onEvent: (event: FsadEvent) => void,
  onError?: (err: Event) => void,
): () => void {
  const es = new EventSource(`${BASE}/events`)

  es.onmessage = (e: MessageEvent<string>) => {
    try {
      const event = JSON.parse(e.data) as FsadEvent
      onEvent(event)
    } catch {
      // ignore malformed events
    }
  }

  if (onError) es.onerror = onError

  return () => es.close()
}

export async function listFiles(path: string): Promise<FileNode[]> {
  const res = await fetch(`${BASE}/files?path=${encodeURIComponent(path)}`)
  if (!res.ok) return []
  return res.json() as Promise<FileNode[]>
}

export async function fetchTopicPage(
  topic_id: string,
  limit: number,
): Promise<{ messages: FsadMessage[]; total: number }> {
  const res = await fetch(`${BASE}/files/topic?topic_id=${encodeURIComponent(topic_id)}&limit=${limit}`)
  if (!res.ok) return { messages: [], total: 0 }
  return res.json() as Promise<{ messages: FsadMessage[]; total: number }>
}


export async function getFileContent(path: string): Promise<string> {
  const res = await fetch(`${BASE}/files/content?path=${encodeURIComponent(path)}`)
  if (!res.ok) throw new Error(`Failed to read ${path}: ${res.status}`)
  const data = (await res.json()) as FileContentResponse
  return data.content
}

export async function getReminders(bot_name: string): Promise<Reminder[]> {
  const res = await fetch(`${BASE}/reminders?bot_name=${encodeURIComponent(bot_name)}`)
  if (!res.ok) return []
  return res.json() as Promise<Reminder[]>
}

export async function deleteReminder(id: string): Promise<void> {
  await fetch(`${BASE}/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
