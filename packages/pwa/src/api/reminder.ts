import type { FileNode, FileContentResponse, Reminder } from '@yeap/shared'

const BASE = import.meta.env['VITE_REMINDER_URL'] ?? '/api/rem'

export async function listFiles(path: string): Promise<FileNode[]> {
  const res = await fetch(`${BASE}/files?path=${encodeURIComponent(path)}`)
  if (!res.ok) return []
  return res.json() as Promise<FileNode[]>
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

