import type { Bot } from '@yeap/shared'

/**
 * Derives a presence color from a bot's last_seen timestamp and status.
 *
 * Bots may set `status` to any free-form text (e.g. "Running analysis").
 * We therefore use `last_seen` recency as the primary signal:
 *   - explicit "offline"  → gray
 *   - seen within 3 min   → green
 *   - seen within 15 min  → amber (likely still running, slow LLM)
 *   - otherwise           → gray
 */
export function botStatusColor(bot: Bot): string {
  if (bot.status === 'offline') return '#6b7280'
  if (bot.last_seen == null) return '#6b7280'
  const age = Date.now() - bot.last_seen
  if (age < 3 * 60 * 1000) return '#22c55e'   // green  — recently active
  if (age < 15 * 60 * 1000) return '#f59e0b'  // amber  — possibly still running
  return '#6b7280'                              // gray   — stale
}

/** Human-readable tooltip: status text + last-seen age */
export function botStatusLabel(bot: Bot): string {
  const age = bot.last_seen == null
    ? 'never'
    : formatAge(Date.now() - bot.last_seen)
  return `${bot.status} · last seen ${age}`
}

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  return `${Math.round(ms / 3_600_000)}h ago`
}
