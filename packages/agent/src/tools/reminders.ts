import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { Reminder, SetReminderPayload } from '@yeap/shared'

const REMINDER_URL = process.env['REMINDER_URL'] ?? 'http://reminder:3001'
const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'

const setReminderParams = Type.Object({
  channel_name: Type.String({ description: 'Channel name to post the reminder in' }),
  content: Type.String({ description: 'Reminder message content' }),
  delay_ms: Type.Optional(Type.Number({ description: 'Delay in milliseconds from now' })),
  fire_at: Type.Optional(Type.Number({ description: 'Unix timestamp (ms) to fire at' })),
})
export const set_reminder: AgentTool<typeof setReminderParams> = {
  name: 'set_reminder',
  label: 'Set Reminder',
  description: 'Set a one-shot reminder to fire after a delay or at a specific Unix timestamp (ms).',
  parameters: setReminderParams,
  execute: async (_id, params) => {
    const payload: SetReminderPayload = {
      bot_name: BOT_NAME,
      topic_id: params.channel_name,
      content: params.content,
      meta_type: 'alert',
      ...(params.delay_ms !== undefined ? { delay_ms: params.delay_ms } : {}),
      ...(params.fire_at !== undefined ? { fire_at: params.fire_at } : {}),
    }
    const res = await fetch(`${REMINDER_URL}/reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = (await res.json()) as { error?: string }
      return { content: [{ type: 'text' as const, text: `Failed to set reminder: ${body.error ?? res.status}` }], details: {} }
    }
    const reminder = (await res.json()) as Reminder
    return { content: [{ type: 'text' as const, text: `Reminder set (id: ${reminder.id})` }], details: {} }
  },
}

const scheduleReminderParams = Type.Object({
  channel_name: Type.String({ description: 'Channel name to post in' }),
  content: Type.String({ description: 'Reminder message content' }),
  cron: Type.String({ description: 'Cron expression e.g. "0 9 * * 1-5" for 9am weekdays' }),
})
export const schedule_reminder: AgentTool<typeof scheduleReminderParams> = {
  name: 'schedule_reminder',
  label: 'Schedule Reminder',
  description: 'Set a recurring reminder using a cron expression.',
  parameters: scheduleReminderParams,
  execute: async (_id, params) => {
    const payload: SetReminderPayload = {
      bot_name: BOT_NAME,
      topic_id: params.channel_name,
      content: params.content,
      cron: params.cron,
      meta_type: 'alert',
    }
    const res = await fetch(`${REMINDER_URL}/reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = (await res.json()) as { error?: string }
      return { content: [{ type: 'text' as const, text: `Failed: ${body.error ?? res.status}` }], details: {} }
    }
    const reminder = (await res.json()) as Reminder
    return { content: [{ type: 'text' as const, text: `Recurring reminder set (id: ${reminder.id}, cron: ${params.cron})` }], details: {} }
  },
}

const listRemindersParams = Type.Object({})
export const list_reminders: AgentTool<typeof listRemindersParams> = {
  name: 'list_reminders',
  label: 'List Reminders',
  description: 'List all active reminders for this bot.',
  parameters: listRemindersParams,
  execute: async () => {
    const res = await fetch(`${REMINDER_URL}/reminders?bot_name=${encodeURIComponent(BOT_NAME)}`)
    if (!res.ok) return { content: [{ type: 'text' as const, text: 'Failed to fetch reminders.' }], details: {} }
    const reminders = (await res.json()) as Reminder[]
    if (!reminders.length) return { content: [{ type: 'text' as const, text: 'No active reminders.' }], details: {} }
    const lines = reminders.map((r) => {
      const when = r.cron ? `cron: ${r.cron}` : r.fire_at ? `at: ${new Date(r.fire_at).toISOString()}` : 'unknown'
      return `- [${r.id.slice(0, 8)}] ${r.content} → #${r.topic_id} (${when})`
    }).join('\n')
    return { content: [{ type: 'text' as const, text: lines }], details: {} }
  },
}

const cancelReminderParams = Type.Object({
  id: Type.String({ description: 'Reminder ID to cancel' }),
})
export const cancel_reminder: AgentTool<typeof cancelReminderParams> = {
  name: 'cancel_reminder',
  label: 'Cancel Reminder',
  description: 'Cancel an active reminder by ID.',
  parameters: cancelReminderParams,
  execute: async (_id_, params) => {
    const res = await fetch(`${REMINDER_URL}/reminders/${params.id}`, { method: 'DELETE' })
    if (res.status === 404) return { content: [{ type: 'text' as const, text: `Reminder '${params.id}' not found.` }], details: {} }
    if (!res.ok) return { content: [{ type: 'text' as const, text: `Failed to cancel: ${res.status}` }], details: {} }
    return { content: [{ type: 'text' as const, text: `Reminder '${params.id}' cancelled.` }], details: {} }
  },
}

const setScriptedReminderParams = Type.Object({
  channel_name: Type.String({ description: 'Channel to post in if the check fails' }),
  content: Type.String({ description: 'Alert message to send if check fails' }),
  cron: Type.String({ description: 'Cron expression for check frequency' }),
  script: Type.String({ description: 'Shell script to run; reminder fires only if exit code != 0' }),
})
export const set_scripted_reminder: AgentTool<typeof setScriptedReminderParams> = {
  name: 'set_scripted_reminder',
  label: 'Set Scripted Reminder',
  description: 'Set a reminder that only fires if a shell script exits non-zero. Useful for health checks.',
  parameters: setScriptedReminderParams,
  execute: async (_id, params) => {
    const payload: SetReminderPayload = {
      bot_name: BOT_NAME,
      topic_id: params.channel_name,
      content: params.content,
      cron: params.cron,
      script: params.script,
      meta_type: 'alert',
    }
    const res = await fetch(`${REMINDER_URL}/reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = (await res.json()) as { error?: string }
      return { content: [{ type: 'text' as const, text: `Failed: ${body.error ?? res.status}` }], details: {} }
    }
    const reminder = (await res.json()) as Reminder
    return { content: [{ type: 'text' as const, text: `Scripted reminder set (id: ${reminder.id})` }], details: {} }
  },
}
