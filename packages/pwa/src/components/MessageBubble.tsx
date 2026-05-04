import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BotAvatar } from './BotAvatar.js'
import type { Bot, FsadMessage } from '@yeap/shared'

type Props = {
  message: FsadMessage
  bots: Bot[]
  depth?: number
  onReply?: (parentPath: string, content: string) => Promise<void>
}

function formatTimestamp(ts: string): string {
  // "20260502T091500.000" → readable
  if (ts.length < 15) return ts
  const y = ts.slice(0, 4)
  const mo = ts.slice(4, 6)
  const d = ts.slice(6, 8)
  const h = ts.slice(9, 11)
  const mi = ts.slice(11, 13)
  return `${y}-${mo}-${d} ${h}:${mi}`
}

export function MessageBubble({ message, bots, depth = 0, onReply }: Props) {
  const [replying, setReplying] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [replySending, setReplySending] = useState(false)
  const [threadOpen, setThreadOpen] = useState(false)

  async function submitReply() {
    const trimmed = replyText.trim()
    if (!trimmed || !onReply) return
    setReplySending(true)
    try {
      await onReply(message.path, trimmed)
      setReplyText('')
      setReplying(false)
    } finally {
      setReplySending(false)
    }
  }
  const isAlert = message.meta?.type === 'alert'
  const indent = depth * 24

  return (
    <div
      style={{
        marginLeft: indent,
        borderLeft: depth > 0 ? '2px solid var(--border)' : undefined,
        paddingLeft: depth > 0 ? 12 : 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 10,
          padding: '10px 0',
          borderLeft: isAlert ? '3px solid #f97316' : undefined,
          paddingLeft: isAlert ? 10 : 0,
        }}
      >
        <BotAvatar bot_name={message.author_name} bots={bots} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>{message.author_name}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {formatTimestamp(message.timestamp)}
            </span>
          </div>
          <div
            style={{
              color: 'var(--text)',
              lineHeight: 1.6,
              fontSize: 14,
            }}
            className="md-body"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        </div>
      </div>

      {message.replies.length > 0 && (
        <div style={{ marginLeft: 42 }}>
          <button
            onClick={() => setThreadOpen((o) => !o)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 12,
              padding: '2px 0 6px',
            }}
          >
            {threadOpen
              ? `▾ Hide ${message.replies.length} ${message.replies.length === 1 ? 'reply' : 'replies'}`
              : `▸ ${message.replies.length} ${message.replies.length === 1 ? 'reply' : 'replies'}`}
          </button>
        </div>
      )}

      {threadOpen && message.replies.map((reply) => (
        <MessageBubble key={reply.path} message={reply} bots={bots} depth={depth + 1} {...(onReply !== undefined ? { onReply } : {})} />
      ))}

      {onReply && (
        <div style={{ marginLeft: 42 }}>
          {!replying ? (
            <button
              onClick={() => setReplying(true)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 12,
                padding: '2px 0 6px',
              }}
            >
              ↩ Reply
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <textarea
                autoFocus
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    void submitReply()
                  }
                  if (e.key === 'Escape') {
                    setReplying(false)
                    setReplyText('')
                  }
                }}
                placeholder="Reply… (Ctrl+Enter to send, Esc to cancel)"
                rows={2}
                style={{
                  flex: 1,
                  resize: 'none',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '6px 8px',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button
                  onClick={() => void submitReply()}
                  disabled={replySending}
                  style={{
                    padding: '5px 10px',
                    background: 'var(--accent)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: replySending ? 'not-allowed' : 'pointer',
                    fontSize: 12,
                    opacity: replySending ? 0.7 : 1,
                  }}
                >
                  Send
                </button>
                <button
                  onClick={() => { setReplying(false); setReplyText('') }}
                  style={{
                    padding: '5px 10px',
                    background: 'none',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
