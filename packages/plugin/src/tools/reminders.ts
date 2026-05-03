import { tool } from '@opencode-ai/plugin'
import type { Reminder, SetReminderPayload } from '@yeap/shared'

const REMINDER_URL = process.env['REMINDER_URL'] ?? 'http://reminder:3001'
const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'

async function postReminder(payload: SetReminderPayload): Promise<string> {
  const res = await fetch(`${REMINDER_URL}/reminders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = (await res.json()) as { error?: string }
    return `Failed: ${body.error ?? res.statusText}`
  }
  const reminder = (await res.json()) as Reminder
  return `Reminder set. ID: ${reminder.id}`
}

export const set_reminder = tool({
  description:
    'Set a one-shot reminder that fires after a delay or at a specific time. When it fires, a message is written to the given topic.',
  args: {
    topic_id: tool.schema.string('Topic to receive the reminder message.'),
    content: tool.schema.string('Reminder message text.'),
    delay_ms: tool.schema
      .number('Milliseconds from now. Mutually exclusive with fire_at.')
      .optional(),
    fire_at: tool.schema
      .number('Unix ms absolute timestamp. Mutually exclusive with delay_ms.')
      .optional(),
  },
  async execute({ topic_id, content, delay_ms, fire_at }) {
    return postReminder({
      bot_name: BOT_NAME,
      topic_id,
      content,
      ...(delay_ms !== undefined ? { delay_ms } : {}),
      ...(fire_at !== undefined ? { fire_at } : {}),
    })
  },
})

export const schedule_reminder = tool({
  description:
    'Set a recurring reminder using a cron expression (5-field, UTC). It will keep firing until cancelled.',
  args: {
    topic_id: tool.schema.string('Topic to receive the reminder message each time it fires.'),
    content: tool.schema.string('Message written each time the reminder fires.'),
    cron: tool.schema.string(
      '5-field cron expression e.g. "0 9 * * 1-5" (Mon-Fri 9am UTC).',
    ),
  },
  async execute({ topic_id, content, cron }) {
    return postReminder({ bot_name: BOT_NAME, topic_id, content, cron })
  },
})

export const list_reminders = tool({
  description: 'List all pending reminders for this bot.',
  args: {},
  async execute() {
    const res = await fetch(`${REMINDER_URL}/reminders?bot_name=${encodeURIComponent(BOT_NAME)}`)
    const reminders = (await res.json()) as Reminder[]
    if (!reminders.length) return 'No pending reminders.'
    return reminders
      .map((r) => {
        const when = r.cron
          ? `cron: ${r.cron}`
          : r.fire_at
          ? `at: ${new Date(r.fire_at).toISOString()}`
          : r.next_fire_at
          ? `next: ${new Date(r.next_fire_at).toISOString()}`
          : 'unknown'
        const preview = r.content.length > 60 ? r.content.slice(0, 57) + '...' : r.content
        return `[${r.id.slice(0, 8)}] ${r.topic_id} | ${when} | ${preview}`
      })
      .join('\n')
  },
})

export const cancel_reminder = tool({
  description: 'Cancel a pending reminder by its ID.',
  args: {
    id: tool.schema.string('Reminder ID returned by set_reminder or schedule_reminder.'),
  },
  async execute({ id }) {
    const res = await fetch(`${REMINDER_URL}/reminders/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    if (res.status === 404) return `Reminder ${id} not found.`
    if (!res.ok) return `Failed to cancel reminder: ${res.statusText}`
    return `Reminder ${id} cancelled.`
  },
})

export const set_scripted_reminder = tool({
  description:
    'Set a conditional reminder: a script is run in your container each time it would fire. ' +
    'The message is only sent to topic_id if the script exits with a non-zero exit code. ' +
    'stdout/stderr from the script are appended to the message. ' +
    'Use this for health-checks, threshold monitors, or any "alert if broken" pattern. ' +
    'Provide either delay_ms (one-shot, milliseconds from now) or cron (recurring, 5-field UTC).',
  args: {
    topic_id: tool.schema.string('Topic to receive the alert message when the script signals a problem.'),
    content: tool.schema.string('Message to send when the script exits non-zero.'),
    script: tool.schema.string(
      'Shell script (sh -c) to run in this container. Exit 0 = all good (silent). ' +
      'Exit non-zero = problem detected (message fires). Keep scripts short and fast.',
    ),
    delay_ms: tool.schema
      .number('One-shot: milliseconds from now. Mutually exclusive with cron.')
      .optional(),
    fire_at: tool.schema
      .number('One-shot: absolute unix timestamp in ms. Mutually exclusive with cron.')
      .optional(),
    cron: tool.schema
      .string('Recurring: 5-field UTC cron expression e.g. "*/5 * * * *" (every 5 min). Mutually exclusive with delay_ms/fire_at.')
      .optional(),
  },
  async execute({ topic_id, content, script, delay_ms, fire_at, cron }) {
    return postReminder({
      bot_name: BOT_NAME,
      topic_id,
      content,
      script,
      ...(delay_ms !== undefined ? { delay_ms } : {}),
      ...(fire_at !== undefined ? { fire_at } : {}),
      ...(cron !== undefined ? { cron } : {}),
    })
  },
})
