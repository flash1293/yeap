/**
 * BotSession.tsx — session history viewer for a bot.
 *
 * Route: /bots/:name/session
 *
 * Reads /pwa/files/read?path=bots/<Name>/session.jsonl via the orchestrator
 * files API and renders each message as a human-readable card.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { readVirtualFile } from '../api/orchestrator.js'

// ── Types matching pi-agent-core session JSONL ────────────────────────────────

type TextPart = { type: 'text'; text: string }
type ThinkingPart = { type: 'thinking'; thinking: string }
type ToolCallPart = { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }
type ToolResultPart = { type: 'toolResult'; id: string; content: string }
type ImagePart = { type: 'image' }
type ContentPart = TextPart | ThinkingPart | ToolCallPart | ToolResultPart | ImagePart

type Message = {
  role: 'user' | 'assistant' | 'toolResult'
  content: ContentPart[] | string
  stopReason?: string
  errorMessage?: string
}

// ── Parsing ───────────────────────────────────────────────────────────────────

function parseSession(jsonl: string): Message[] {
  return jsonl
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Message]
      } catch {
        return []
      }
    })
}

function contentText(c: ContentPart): string {
  if (c.type === 'text') return c.text
  if (c.type === 'thinking') return c.thinking
  if (c.type === 'toolResult') return c.content
  return ''
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ToolCallCard({ part }: { part: ToolCallPart }) {
  const [open, setOpen] = useState(false)
  const args = JSON.stringify(part.arguments, null, 2)
  const short = args.length > 120 ? args.slice(0, 120) + '…' : args
  return (
    <div
      style={{
        background: '#1e293b',
        border: '1px solid #334155',
        borderRadius: 6,
        padding: '8px 10px',
        fontSize: 12,
        fontFamily: 'monospace',
        marginTop: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ color: '#818cf8', fontWeight: 700 }}>⚡ {part.name}</span>
        <span style={{ color: '#64748b', fontSize: 11 }}>{part.id.slice(0, 16)}</span>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            fontSize: 11,
            padding: 0,
          }}
        >
          {open ? '▲ collapse' : '▼ expand'}
        </button>
      </div>
      <pre
        style={{
          marginTop: 4,
          color: '#94a3b8',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: open ? 'none' : 48,
          overflow: open ? 'visible' : 'hidden',
        }}
      >
        {open ? args : short}
      </pre>
    </div>
  )
}

function ThinkingCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      style={{
        background: 'rgba(99,102,241,0.06)',
        border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: 6,
        padding: '6px 10px',
        fontSize: 12,
        marginTop: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#818cf8', fontSize: 11 }}>💭 thinking</span>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            fontSize: 11,
            padding: 0,
            marginLeft: 'auto',
          }}
        >
          {open ? '▲' : '▼'}
        </button>
      </div>
      {open && (
        <pre
          style={{
            marginTop: 6,
            color: '#94a3b8',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {text}
        </pre>
      )}
    </div>
  )
}

function MessageCard({ msg, index }: { msg: Message; index: number }) {
  const parts: ContentPart[] = typeof msg.content === 'string'
    ? [{ type: 'text', text: msg.content }]
    : (msg.content as ContentPart[])

  const isUser = msg.role === 'user'
  const isToolResult = msg.role === 'toolResult'

  const roleLabel = isToolResult ? 'tool result' : msg.role
  const roleColor = isUser ? '#38bdf8' : isToolResult ? '#4ade80' : '#f472b6'
  const bgColor = isUser ? 'rgba(56,189,248,0.04)' : isToolResult ? 'rgba(74,222,128,0.04)' : 'rgba(244,114,182,0.04)'
  const borderColor = isUser ? 'rgba(56,189,248,0.15)' : isToolResult ? 'rgba(74,222,128,0.15)' : 'rgba(244,114,182,0.15)'

  return (
    <div
      style={{
        background: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: roleColor, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {roleLabel}
        </span>
        <span style={{ fontSize: 10, color: '#475569', marginLeft: 'auto' }}>#{index + 1}</span>
        {msg.stopReason && (
          <span
            style={{
              fontSize: 10,
              color: msg.stopReason === 'stop' ? '#4ade80' : msg.stopReason === 'toolUse' ? '#818cf8' : '#f87171',
              border: `1px solid currentColor`,
              borderRadius: 3,
              padding: '1px 5px',
            }}
          >
            {msg.stopReason}
          </span>
        )}
        {msg.errorMessage && (
          <span style={{ fontSize: 10, color: '#f87171' }}>⚠ {msg.errorMessage.slice(0, 60)}</span>
        )}
      </div>

      {/* Content parts */}
      {parts.map((part, i) => {
        if (part.type === 'thinking') {
          return <ThinkingCard key={i} text={part.thinking} />
        }
        if (part.type === 'toolCall') {
          return <ToolCallCard key={i} part={part} />
        }
        if (part.type === 'toolResult') {
          return (
            <pre
              key={i}
              style={{
                color: '#94a3b8',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.5,
                maxHeight: 200,
                overflow: 'auto',
              }}
            >
              {part.content}
            </pre>
          )
        }
        if (part.type === 'text') {
          return (
            <pre
              key={i}
              style={{
                color: '#e2e8f0',
                fontSize: 13,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.6,
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
              {part.text}
            </pre>
          )
        }
        return null
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function BotSession() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [filter, setFilter] = useState<'all' | 'user' | 'assistant' | 'toolCall' | 'toolResult'>('all')
  const [search, setSearch] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  async function load() {
    if (!name) return
    try {
      const raw = await readVirtualFile(`bots/${name}/session.jsonl`)
      setMessages(parseSession(raw))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load session')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [name]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [autoRefresh, name]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = messages.filter((msg) => {
    if (filter === 'toolCall') {
      const parts = typeof msg.content === 'string' ? [] : (msg.content as ContentPart[])
      return parts.some((p) => p.type === 'toolCall')
    }
    if (filter === 'toolResult') {
      const parts = typeof msg.content === 'string' ? [] : (msg.content as ContentPart[])
      return parts.some((p) => p.type === 'toolResult') || msg.role === 'toolResult'
    }
    if (filter !== 'all') return msg.role === filter
    return true
  }).filter((msg) => {
    if (!search) return true
    const parts: ContentPart[] = typeof msg.content === 'string'
      ? [{ type: 'text', text: msg.content }]
      : (msg.content as ContentPart[])
    const text = parts.map(contentText).join(' ').toLowerCase()
    return text.includes(search.toLowerCase())
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Nav */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={() => navigate('/bots')}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: 0 }}
        >
          ← Bots
        </button>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{name} — session</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{messages.length} messages</span>

        {/* Search */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          style={{
            marginLeft: 'auto',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 5,
            padding: '4px 8px',
            color: 'var(--text)',
            fontSize: 12,
            width: 160,
          }}
        />

        {/* Filter */}
        {(['all', 'user', 'assistant', 'toolCall', 'toolResult'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '3px 9px',
              borderRadius: 5,
              border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`,
              background: filter === f ? 'var(--accent)' : 'var(--bg)',
              color: filter === f ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            {f}
          </button>
        ))}

        {/* Auto-refresh */}
        <button
          onClick={() => setAutoRefresh((v) => !v)}
          title="Auto-refresh every 3s"
          style={{
            padding: '3px 9px',
            borderRadius: 5,
            border: `1px solid ${autoRefresh ? '#4ade80' : 'var(--border)'}`,
            background: autoRefresh ? 'rgba(74,222,128,0.1)' : 'var(--bg)',
            color: autoRefresh ? '#4ade80' : 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          {autoRefresh ? '⏸ live' : '▶ live'}
        </button>

        <button
          onClick={() => void load()}
          style={{ padding: '3px 9px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}
        >
          ↻
        </button>

        <button
          onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
          style={{ padding: '3px 9px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}
        >
          ↓ end
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 900, width: '100%', margin: '0 auto' }}>
        {loading && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>}
        {error && <p style={{ color: '#f87171', fontSize: 13 }}>Error: {error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No messages{search || filter !== 'all' ? ' matching filter' : ''}.</p>
        )}
        {filtered.map((msg, i) => (
          <MessageCard key={i} msg={msg} index={i} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
