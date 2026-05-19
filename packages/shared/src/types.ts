// ── Bot ───────────────────────────────────────────────────────────────────────

export type BotStatus = 'online' | 'offline' | 'busy' | (string & {})

export type Bot = {
  id: string
  name: string
  svg_icon: string
  role_description: string
  status: BotStatus
  last_seen: number | null
  admin_url: string | null
  host_port: number | null
  is_coordinator: boolean
  subscriptions: string[]
  messages_since_compact: number
  last_compact_at: number | null
  mattermost_user_id: string | null
}

export type Subscription = {
  bot_id: string
  topic_id: string
}

export type SpawnLog = {
  id: string
  requested_by: string
  bot_name: string
  role: string
  model: string
  timestamp: number
  container_id: string | null
}

// ── FSAD messages ─────────────────────────────────────────────────────────────

export type MessageType = 'text' | 'alert' | 'status'

export type MessageMeta = {
  type: MessageType
  trace_id?: string
  reminder_id?: string
}

// ── Setup ─────────────────────────────────────────────────────────────────────

export type SetupStatus = {
  initialized: boolean
}

export type SetupInitPayload = {
  coordinator_name: string
  provider: string
  model: string
  api_key: string
  base_url?: string
  context_window?: number
  max_output?: number
  pwa_password: string
  /** Mattermost admin account - defaults to admin@yeap.local / yeap-admin / pwa_password */
  mm_admin_email?: string
  mm_admin_username?: string
  mm_admin_password?: string
}

// ── Reminders ─────────────────────────────────────────────────────────────────

export type SetReminderPayload = {
  bot_name: string
  topic_id: string
  content: string
  delay_ms?: number
  fire_at?: number
  cron?: string
  author_mode?: 'bot' | 'Reminder'
  meta_type?: 'text' | 'alert'
  /** Shell script to run in the bot's container. Message is only sent if exit code != 0. */
  script?: string
}

export type Reminder = {
  id: string
  bot_name: string
  topic_id: string
  content: string
  fire_at: number | null
  cron: string | null
  next_fire_at: number | null
  created_at: number
  author_mode: 'bot' | 'Reminder'
  meta_type: 'text' | 'alert'
  /** If set, this is a scripted reminder: only fires when the script exits non-zero. */
  script: string | null
}

// ── HTTP payloads — Orchestrator ──────────────────────────────────────────────

export type LoginPayload = { password: string }
export type LoginResponse = { token: string }

export type RegisterBotPayload = {
  name: string
  role_description: string
  admin_url?: string
}
export type RegisterBotResponse = { bot: Bot }

export type UpdateBotPayload = {
  status?: BotStatus
  last_seen?: number
  admin_url?: string
}

export type UpdateStatusPayload = { name: string; status: BotStatus }

export type SpawnPayload = {
  requested_by: string
  name: string
  role: string
  model: string
}
export type SpawnResponse = {
  container_id: string
  bot: Bot
}

export type WebhookPayload = Record<string, unknown>

export type SubscribePayload = {
  bot_name: string
  topic_id: string
}

export type UnsubscribePayload = {
  bot_name: string
  topic_id: string
}

// ── HTTP payloads — Reminder ──────────────────────────────────────────────────

export type FileNode = {
  name: string
  path: string
  is_dir: boolean
  modified_at: number
}

export type FileContentResponse = {
  content: string
}
