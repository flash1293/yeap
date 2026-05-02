import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { getBots, sendMessage } from '../api/orchestrator.js'
import { subscribeEvents, listFiles } from '../api/reminder.js'
import { loadTopicPage, loadTopics } from '../lib/fsad.js'
import { BotStatusBar } from '../components/BotStatusBar.js'
import { MessageBubble } from '../components/MessageBubble.js'
import { MessageInput } from '../components/MessageInput.js'
import { useAuthStore } from '../store/auth.js'
import { useUnreadStore } from '../store/unread.js'
import { useNotificationsStore } from '../store/notifications.js'
import type { Bot, FsadMessage } from '@yeap/shared'

export function Chat() {
  const { '*': topicParam } = useParams()
  const topicId = topicParam || 'human'
  const navigate = useNavigate()

  const [topics, setTopics] = useState<string[]>([])
  const [bots, setBots] = useState<Bot[]>([])
  const [messages, setMessages] = useState<FsadMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [visibleCount, setVisibleCount] = useState(20)
  const [totalMessages, setTotalMessages] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const clear = useAuthStore((s) => s.clear)
  const unreadCounts = useUnreadStore((s) => s.counts)
  const incrementUnread = useUnreadStore((s) => s.increment)
  const clearUnread = useUnreadStore((s) => s.clear)
  const isMuted = useNotificationsStore((s) => s.isMuted)
  const toggleMute = useNotificationsStore((s) => s.toggle)

  // Request browser notification permission once
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }, [])

  // Clear unread count for the active topic
  useEffect(() => {
    clearUnread(topicId)
  }, [topicId, clearUnread])

  // Load topics and bots
  useEffect(() => {
    void loadTopics().then(setTopics)
    void getBots().then(setBots).catch(() => undefined)
  }, [])

  // Load messages for current topic
  useEffect(() => {
    setLoadingMessages(true)
    setVisibleCount(20)
    void loadTopicPage(topicId, 20)
      .then(({ messages, total }) => {
        setMessages(messages)
        setTotalMessages(total)
      })
      .finally(() => setLoadingMessages(false))
  }, [topicId])

  // SSE — reload on any new message in current topic
  useEffect(() => {
    const unsub = subscribeEvents((event) => {
      if (event.type === 'connected') return
      if (event.topic_id === topicId) {
        void loadTopicPage(topicId, visibleCount).then(({ messages, total }) => {
          setMessages(messages)
          setTotalMessages(total)
        })
      } else {
        // Track unread count for topics we're not currently viewing
        incrementUnread(event.topic_id)
      }
      // Fire a browser notification when the tab is hidden or topic is inactive,
      // unless the topic is muted by the user.
      if (
        'Notification' in window &&
        Notification.permission === 'granted' &&
        !isMuted(event.topic_id) &&
        (document.hidden || event.topic_id !== topicId)
      ) {
        const body = event.content.length > 120
          ? event.content.slice(0, 117) + '…'
          : event.content
        const n = new Notification(`#${event.topic_id}`, {
          body: `${event.author_name}: ${body}`,
          tag: `yeap-${event.topic_id}`,
          icon: '/icon-192.png',
        } as NotificationOptions & { renotify: boolean })
        n.onclick = () => {
          window.focus()
          n.close()
        }
      }
      // Refresh topic list so new topics appear in sidebar
      void loadTopics().then(setTopics)
    })
    return unsub
  }, [topicId, incrementUnread, visibleCount])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Track viewport width for responsive layout
  useEffect(() => {
    function onResize() {
      const mobile = window.innerWidth < 640
      setIsMobile(mobile)
      if (!mobile) setSidebarOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  async function handleLoadMore() {
    const nextCount = visibleCount + 20
    setLoadingMore(true)
    try {
      const { messages, total } = await loadTopicPage(topicId, nextCount)
      setMessages(messages)
      setTotalMessages(total)
      setVisibleCount(nextCount)
    } finally {
      setLoadingMore(false)
    }
  }

  async function handleSend(content: string) {
    await sendMessage({ topic_id: topicId, content })
  }

  async function handleReply(parent_path: string, content: string) {
    await sendMessage({ topic_id: topicId, content, parent_path })
  }

  function logout() {
    clear()
    void navigate('/login')
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 99,
          }}
        />
      )}

      {/* Sidebar */}
      <aside
        style={{
          width: 220,
          borderRight: '1px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          ...(isMobile
            ? {
                position: 'fixed',
                top: 0,
                left: 0,
                bottom: 0,
                zIndex: 100,
                transform: `translateX(${sidebarOpen ? 0 : -220}px)`,
                transition: 'transform 0.25s ease',
              }
            : {}),
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            fontWeight: 700,
            fontSize: 16,
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          YEAP
          <button
            onClick={logout}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            out
          </button>
        </div>
        <button
          onClick={() => void navigate('/bots')}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '8px 16px',
            background: 'none',
            border: 'none',
            borderBottom: '1px solid var(--border)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Bots
        </button>
        <button
          onClick={() => void navigate('/files')}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '8px 16px',
            background: 'none',
            border: 'none',
            borderBottom: '1px solid var(--border)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Files
        </button>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {topics.length === 0 && (
            <p style={{ padding: '8px 16px', color: 'var(--text-muted)', fontSize: 12 }}>
              No topics yet
            </p>
          )}
          {topics.map((t) => {
            const unread = unreadCounts[t] ?? 0
            return (
              <button
                key={t}
                onClick={() => {
                  void navigate(`/chat/${t}`)
                  if (isMobile) setSidebarOpen(false)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  textAlign: 'left',
                  padding: '7px 16px',
                  background: t === topicId ? 'var(--bg)' : 'none',
                  border: 'none',
                  color: t === topicId ? 'var(--text)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 13,
                  borderLeft: t === topicId ? '3px solid var(--accent)' : '3px solid transparent',
                }}
              >
                <span>#{t}</span>
                {unread > 0 && (
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
                      lineHeight: 1,
                    }}
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Mobile top bar */}
        {/* Topic header — always visible */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          {isMobile && (
            <button
              onClick={() => setSidebarOpen(true)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text)',
                cursor: 'pointer',
                fontSize: 20,
                lineHeight: 1,
                padding: '0 4px',
              }}
              aria-label="Open menu"
            >
              ☰
            </button>
          )}
          <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>#{topicId}</span>
          <button
            onClick={() => toggleMute(topicId)}
            title={isMuted(topicId) ? 'Notifications muted — click to enable' : 'Notifications on — click to mute'}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 6,
              cursor: 'pointer',
              padding: '3px 8px',
              fontSize: 16,
              lineHeight: 1,
              color: isMuted(topicId) ? 'var(--text-muted)' : 'var(--accent)',
              opacity: isMuted(topicId) ? 0.5 : 1,
            }}
            aria-label={isMuted(topicId) ? 'Enable notifications' : 'Mute notifications'}
          >
            {isMuted(topicId) ? '🔕' : '🔔'}
          </button>
        </div>
        <BotStatusBar />

        {/* Message list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {loadingMessages && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
          )}
          {!loadingMessages && totalMessages > visibleCount && (
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <button
                onClick={() => void handleLoadMore()}
                disabled={loadingMore}
                style={{
                  background: 'none',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text-muted)',
                  cursor: loadingMore ? 'default' : 'pointer',
                  fontSize: 12,
                  padding: '4px 12px',
                  opacity: loadingMore ? 0.6 : 1,
                }}
              >
                {loadingMore ? 'Loading…' : `Load older messages (${totalMessages - visibleCount} more)`}
              </button>
            </div>
          )}
          {!loadingMessages && messages.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No messages yet in #{topicId}</p>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.path} message={m} bots={bots} onReply={handleReply} />
          ))}
          <div ref={bottomRef} />
        </div>

        <MessageInput onSend={handleSend} />
      </div>
    </div>
  )
}
