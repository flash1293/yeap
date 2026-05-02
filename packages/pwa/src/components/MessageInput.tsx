import { useRef, useState, type KeyboardEvent } from 'react'

type Props = {
  onSend: (content: string) => Promise<void>
  disabled?: boolean
}

export function MessageInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isTouchDevice = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0

  async function submit() {
    const trimmed = value.trim()
    if (!trimmed || sending) return
    setSending(true)
    try {
      await onSend(trimmed)
      setValue('')
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter') {
      if (isTouchDevice && !e.shiftKey) {
        e.preventDefault()
        void submit()
      } else if (!isTouchDevice && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        void submit()
      }
    }
  }

  return (
    <div
      style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
        display: 'flex',
        gap: 8,
        alignItems: 'flex-end',
      }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={isTouchDevice ? 'Type a message… (Enter to send)' : 'Type a message… (Ctrl+Enter to send)'}
        disabled={disabled || sending}
        rows={isTouchDevice ? 2 : 3}
        style={{
          flex: 1,
          resize: 'none',
          background: 'var(--bg)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '8px 10px',
          fontSize: 14,
          fontFamily: 'inherit',
          outline: 'none',
        }}
      />
      <button
        onClick={() => void submit()}
        disabled={disabled || sending || !value.trim()}
        style={{
          padding: '8px 16px',
          background: 'var(--accent)',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 14,
          opacity: disabled || sending || !value.trim() ? 0.5 : 1,
        }}
      >
        {sending ? '…' : 'Send'}
      </button>
    </div>
  )
}
