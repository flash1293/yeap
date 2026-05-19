import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core'

export const bots = sqliteTable('bots', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  svg_icon: text('svg_icon').notNull(),
  role_description: text('role_description').notNull(),
  status: text('status').notNull().default('offline'),
  last_seen: integer('last_seen'),
  // admin_url: agent admin server URL (http://yeap-bot-<slug>:4096)
  admin_url: text('opencode_url'),
  // host_port kept as nullable for backward compat; unused in new design
  host_port: integer('host_port'),
  is_coordinator: integer('is_coordinator', { mode: 'boolean' }).notNull().default(false),
  messages_since_compact: integer('messages_since_compact').notNull().default(0),
  last_compact_at: integer('last_compact_at'),
  mattermost_user_id: text('mattermost_user_id'),
  mattermost_token: text('mattermost_token'),
})

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    bot_id: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    topic_id: text('topic_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.bot_id, t.topic_id] })],
)

export const spawn_log = sqliteTable('spawn_log', {
  id: text('id').primaryKey(),
  requested_by: text('requested_by').notNull(),
  bot_name: text('bot_name').notNull(),
  role: text('role').notNull(),
  model: text('model').notNull(),
  timestamp: integer('timestamp').notNull(),
  container_id: text('container_id'),
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
