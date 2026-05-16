import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { getBots, subscribeBot, unsubscribeBot, resetBot, compactBot } from '../api/orchestrator.js'
import { getReminders, deleteReminder } from '../api/reminder.js'
import { BotAvatar } from '../components/BotAvatar.js'
import { botStatusColor, botStatusLabel } from '../lib/botStatus.js'
import type { Bot, Reminder } from '@yeap/shared'

function inboxTopic(name: string): string {
  return `inbox-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 57)}`
}

export function Bots() {
  const navigate = useNavigate()
  const [bots, setBots] = useState<Bot[]>([])
  const [loading, setLoading] = useState(true)
  const [addSub, setAddSub] = useState<Record<string, string>>({})
  const [addError, setAddError] = useState<Record<string, string>>({})
  const [reminders, setReminders] = useState<Record<string, Reminder[]>>({})
  const [expandedReminders, setExpandedReminders] = useState<Record<string, boolean>>({})
  const [resetting, setResetting] = useState<Record<string, boolean>>({})
  const [compacting, setCompacting] = useState<Record<string, boolean>>({})

  async function load() {
    const data = await getBots().catch(() => [] as Bot[])
    setBots(data)
    setLoading(false)
    // Load reminders for all bots in parallel
    const entries = await Promise.all(
      data.map(async (bot) => {
        const rems = await getReminders(bot.name).catch(() => [] as Reminder[])
        return [bot.name, rems] as const
      }),
    )
    setReminders(Object.fromEntries(entries))
  }

  useEffect(() => {
    void load()
    const id = setInterval(load, 8_000)
    return () => clearInterval(id)
  }, [])

  async function handleDeleteReminder(botName: string, reminderId: string) {
    await deleteReminder(reminderId).catch(() => undefined)
    setReminders((prev) => ({
      ...prev,
      [botName]: (prev[botName] ?? []).filter((r) => r.id !== reminderId),
    }))
  }

  function formatFireTime(r: Reminder): string {
    if (r.cron) return `cron: ${r.cron} (next: ${r.next_fire_at ? new Date(r.next_fire_at).toLocaleString() : '?'})`
    const t = r.fire_at ?? r.next_fire_at
    if (!t) return 'unknown'
    return new Date(t).toLocaleString()
  }

  function reminderKindLabel(r: Reminder): string {
    if (r.script) return r.cron ? 'scripted cron' : 'scripted'
    return r.cron ? 'cron' : 'one-shot'
  }

  function reminderKindColor(r: Reminder): { bg: string; fg: string } {
    if (r.script) return { bg: '#16a34a22', fg: '#4ade80' }
    if (r.cron) return { bg: '#7c3aed22', fg: '#a78bfa' }
    return { bg: '#0ea5e922', fg: '#38bdf8' }
  }

  async function handleUnsubscribe(botName: string, topic: string) {
    await unsubscribeBot(botName, topic).catch(() => undefined)
    void load()
  }

  async function handleReset(botName: string) {
    if (!confirm(`Reset ${botName}? This will recreate the container. Memory and files are preserved.`)) return
    setResetting((p) => ({ ...p, [botName]: true }))
    try {
      await resetBot(botName)
      void load()
    } catch {
      // ignore
    } finally {
      setResetting((p) => ({ ...p, [botName]: false }))
    }
  }

  async function handleCompact(botName: string) {
    setCompacting((p) => ({ ...p, [botName]: true }))
    try {
      await compactBot(botName)
      void load()
    } catch {
      // ignore
    } finally {
      setCompacting((p) => ({ ...p, [botName]: false }))
    }
  }

  async function handleSubscribe(bot: Bot) {
    const topic = (addSub[bot.name] ?? '').trim().toLowerCase()
    if (!topic) return
    if (!/^[a-z0-9-]{1,64}$/.test(topic)) {
      setAddError((p) => ({ ...p, [bot.name]: 'Topic must be lowercase letters, numbers and hyphens (max 64)' }))
      return
    }
    setAddError((p) => ({ ...p, [bot.name]: '' }))
    await subscribeBot(bot.name, topic).catch(() => undefined)
    setAddSub((p) => ({ ...p, [bot.name]: '' }))
    void load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Top nav */}
      <div
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 16 }}>Bots</span>
        <button
          onClick={() => navigate('/files')}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 13,
            padding: 0,
            marginLeft: 'auto',
          }}
        >
          Files →
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {loading && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>}

        {!loading && bots.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No bots registered yet.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
          {bots.map((bot) => (
            <div
              key={bot.name}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {/* Header row */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <BotAvatar bot_name={bot.name} bots={bots} size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{bot.name}</span>
                    <span
                      title={botStatusLabel(bot)}
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: botStatusColor(bot),
                        display: 'inline-block',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{bot.status}</span>
                    {bot.is_coordinator && (
                      <span
                        style={{
                          fontSize: 11,
                          padding: '1px 6px',
                          background: 'var(--accent)',
                          color: '#fff',
                          borderRadius: 4,
                        }}
                      >
                        coordinator
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.4 }}>
                    {bot.role_description.length > 120
                      ? bot.role_description.slice(0, 120) + '…'
                      : bot.role_description}
                  </div>
                </div>
                <button
                  onClick={() => void handleCompact(bot.name)}
                  disabled={compacting[bot.name] || bot.status !== 'online'}
                  title={`Compact context (${bot.messages_since_compact} msgs since last compact)`}
                  style={{
                    padding: '6px 10px',
                    background: 'var(--bg)',
                    color: bot.messages_since_compact >= 40 ? '#f59e0b' : 'var(--text-muted)',
                    border: `1px solid ${bot.messages_since_compact >= 40 ? '#f59e0b' : 'var(--border)'}`,
                    borderRadius: 6,
                    cursor: bot.status !== 'online' ? 'default' : 'pointer',
                    fontSize: 12,
                    flexShrink: 0,
                    opacity: compacting[bot.name] ? 0.6 : 1,
                  }}
                >
                  {compacting[bot.name] ? '…' : `⌛ ${bot.messages_since_compact}`}
                </button>
                <button
                  onClick={() => void handleReset(bot.name)}
                  disabled={resetting[bot.name]}
                  title="Recreate container (keeps memory/files)"
                  style={{
                    padding: '6px 10px',
                    background: 'var(--bg)',
                    color: '#f87171',
                    border: '1px solid #f8717144',
                    borderRadius: 6,
                    cursor: resetting[bot.name] ? 'default' : 'pointer',
                    fontSize: 12,
                    flexShrink: 0,
                    opacity: resetting[bot.name] ? 0.6 : 1,
                  }}
                >
                  {resetting[bot.name] ? '…' : '↺ Reset'}
                </button>
                <button
                  onClick={() => navigate(`/bots/${encodeURIComponent(bot.name)}/session`)}
                  title="View session history"
                  style={{
                    padding: '6px 10px',
                    background: 'var(--bg)',
                    color: '#818cf8',
                    border: '1px solid rgba(129,140,248,0.3)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 12,
                    flexShrink: 0,
                  }}
                >
                  🔍 Session
                </button>
              </div>

              {/* Subscriptions */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Subscribed topics
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {bot.subscriptions.map((t) => (
                    <span
                      key={t}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                        padding: '2px 6px 2px 8px',
                        fontSize: 12,
                      }}
                    >
                      #{t}
                      <button
                        onClick={() => void handleUnsubscribe(bot.name, t)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: '0 2px',
                          fontSize: 15,
                          lineHeight: 1,
                        }}
                        title={`Unsubscribe from #${t}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {bot.subscriptions.length === 0 && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>none</span>
                  )}
                </div>
              </div>

              {/* Add subscription */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={addSub[bot.name] ?? ''}
                    onChange={(e) => setAddSub((p) => ({ ...p, [bot.name]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleSubscribe(bot) }}
                    placeholder="add-topic-id"
                    style={{
                      flex: 1,
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '5px 8px',
                      fontSize: 12,
                      fontFamily: 'inherit',
                    }}
                  />
                  <button
                    onClick={() => void handleSubscribe(bot)}
                    style={{
                      padding: '5px 12px',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      cursor: 'pointer',
                      color: 'var(--text)',
                      fontSize: 12,
                      flexShrink: 0,
                    }}
                  >
                    + Subscribe
                  </button>
                </div>
                {addError[bot.name] && (
                  <span style={{ fontSize: 11, color: '#f87171' }}>{addError[bot.name]}</span>
                )}
              </div>

              {/* Reminders */}
              {(() => {
                const botReminders = reminders[bot.name] ?? []
                const expanded = expandedReminders[bot.name] ?? false
                return (
                  <div>
                    <button
                      onClick={() =>
                        setExpandedReminders((p) => ({ ...p, [bot.name]: !expanded }))
                      }
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        color: 'var(--text-muted)',
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      <span>{expanded ? '▾' : '▸'}</span>
                      <span>Schedules &amp; reminders</span>
                      {botReminders.length > 0 && (
                        <span
                          style={{
                            background: 'var(--accent)',
                            color: '#fff',
                            borderRadius: 10,
                            fontSize: 10,
                            fontWeight: 700,
                            minWidth: 16,
                            height: 16,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '0 4px',
                          }}
                        >
                          {botReminders.length}
                        </span>
                      )}
                    </button>
                    {expanded && (
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {botReminders.length === 0 && (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No scheduled reminders</span>
                        )}
                        {botReminders.map((r) => (
                          <div
                            key={r.id}
                            style={{
                              background: 'var(--bg)',
                              border: '1px solid var(--border)',
                              borderRadius: 6,
                              padding: '8px 10px',
                              fontSize: 12,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 3,
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                              <span
                                style={{
                                  flex: 1,
                                  color: 'var(--text)',
                                  wordBreak: 'break-word',
                                  lineHeight: 1.4,
                                }}
                              >
                                {r.content.length > 160 ? r.content.slice(0, 157) + '…' : r.content}
                              </span>
                              <button
                                onClick={() => void handleDeleteReminder(bot.name, r.id)}
                                title="Cancel reminder"
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--text-muted)',
                                  cursor: 'pointer',
                                  fontSize: 15,
                                  lineHeight: 1,
                                  padding: '0 2px',
                                  flexShrink: 0,
                                }}
                              >
                                ×
                              </button>
                            </div>
                            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                              <span style={{
                                display: 'inline-block',
                                marginRight: 8,
                                padding: '1px 5px',
                                background: reminderKindColor(r).bg,
                                color: reminderKindColor(r).fg,
                                borderRadius: 3,
                                fontSize: 10,
                                fontWeight: 600,
                              }}
                              >
                                {reminderKindLabel(r)}
                              </span>
                              topic: #{r.topic_id} · fires: {formatFireTime(r)}
                            </div>
                            {r.script && (
                              <div style={{
                                marginTop: 4,
                                padding: '4px 6px',
                                background: 'var(--bg)',
                                border: '1px solid #16a34a44',
                                borderRadius: 4,
                                fontFamily: 'monospace',
                                fontSize: 11,
                                color: '#4ade80',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all',
                              }}>
                                {r.script.length > 200 ? r.script.slice(0, 197) + '…' : r.script}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
