import { useEffect, useState } from 'react'
import { getBots } from '../api/orchestrator.js'
import { BotAvatar } from './BotAvatar.js'
import { botStatusColor, botStatusLabel } from '../lib/botStatus.js'
import type { Bot } from '@yeap/shared'

export function BotStatusBar() {
  const [bots, setBots] = useState<Bot[]>([])

  useEffect(() => {
    let cancelled = false
    async function fetch_() {
      const data = await getBots().catch(() => [] as Bot[])
      if (!cancelled) setBots(data)
    }
    void fetch_()
    const id = setInterval(fetch_, 10_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (!bots.length) return null

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        padding: '8px 16px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      {bots.map((bot) => (
        <div
          key={bot.name}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
          title={botStatusLabel(bot)}
        >
          <BotAvatar bot_name={bot.name} bots={bots} size={20} />
          <span>{bot.name}</span>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: botStatusColor(bot),
              display: 'inline-block',
            }}
          />
        </div>
      ))}
    </div>
  )
}
