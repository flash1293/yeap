import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { listVirtualFiles, sendDashboardMessage } from '../api/orchestrator.js'
import type { FileEntry } from '../api/orchestrator.js'
import { useStarsStore } from '../store/stars.js'

type TreeCache = Map<string, FileEntry[]>

function formatSize(bytes: number): string {
  if (bytes === 0) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}

type Props = {
  selectedFile: string | null
  currentPage: 'bots' | 'files'
  isOpen: boolean
  onClose: () => void
}

export function AppSidebar({ selectedFile, currentPage, isOpen, onClose }: Props) {
  const navigate = useNavigate()
  const [cache, setCache] = useState<TreeCache>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']))
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())
  const { starred, toggle, isStarred } = useStarsStore()

  const loadDir = useCallback(
    async (path: string) => {
      if (cache.has(path)) return
      setLoadingDirs((s) => new Set(s).add(path))
      try {
        const entries = await listVirtualFiles(path)
        entries.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        setCache((prev) => new Map(prev).set(path, entries))
      } catch {
        setCache((prev) => new Map(prev).set(path, []))
      } finally {
        setLoadingDirs((s) => {
          const n = new Set(s)
          n.delete(path)
          return n
        })
      }
    },
    [cache],
  )

  // Load root on mount
  useEffect(() => {
    void loadDir('')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Expand ancestors when a file is selected
  useEffect(() => {
    if (!selectedFile) return
    const parts = selectedFile.split('/')
    const ancestors = parts.map((_, i) => parts.slice(0, i).join('/')).filter((_, i) => i <= parts.length - 1)
    setExpanded((s) => {
      const n = new Set(s)
      for (const a of ancestors) n.add(a)
      return n
    })
    void (async () => {
      for (const a of ancestors) await loadDir(a)
    })()
  }, [selectedFile]) // eslint-disable-line react-hooks/exhaustive-deps

  // Relay postMessage from sandboxed dashboard iframes to the bot's inbox
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!event.data || event.data.type !== 'yeap-message') return
      const { bot, message } = event.data as { bot?: unknown; message?: unknown }
      if (typeof bot !== 'string' || typeof message !== 'string') return
      sendDashboardMessage(bot, message).catch(() => {})
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  async function handleDirClick(path: string) {
    if (expanded.has(path)) {
      setExpanded((s) => { const n = new Set(s); n.delete(path); return n })
    } else {
      setExpanded((s) => new Set(s).add(path))
      await loadDir(path)
    }
  }

  function handleFileClick(path: string) {
    void navigate(`/files/${path}`)
    onClose()
  }

  function renderEntries(parentPath: string, depth: number): React.ReactNode {
    const entries = cache.get(parentPath)
    if (!entries) return null
    if (entries.length === 0) {
      return (
        <div style={{ paddingLeft: depth * 16 + 24, paddingTop: 2, paddingBottom: 2, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', opacity: 0.6 }}>
          (empty)
        </div>
      )
    }
    return entries.map((entry) => {
      const childPath = parentPath ? `${parentPath}/${entry.name}` : entry.name
      const isExpanded = expanded.has(childPath)
      const isLoading = loadingDirs.has(childPath)
      const isSelected = selectedFile === childPath
      const isDir = entry.type === 'dir'

      return (
        <div key={childPath}>
          <div
            style={{
              paddingLeft: depth * 16 + 8,
              paddingRight: 4,
              paddingTop: 3,
              paddingBottom: 3,
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: 'monospace',
              background: isSelected ? 'var(--accent)' : 'transparent',
              color: isSelected ? '#fff' : isDir ? 'var(--text)' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              userSelect: 'none',
              borderRadius: 3,
            }}
          >
            <span
              onClick={() => isDir ? void handleDirClick(childPath) : void handleFileClick(childPath)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 }}
            >
              <span style={{ opacity: 0.55, fontSize: 9, width: 10, textAlign: 'center', flexShrink: 0 }}>
                {isDir ? (isLoading ? '…' : isExpanded ? '▾' : '▸') : '·'}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {entry.name}{isDir ? '/' : ''}
              </span>
              {!isDir && entry.size > 0 && (
                <span style={{ opacity: 0.4, fontSize: 10, flexShrink: 0 }}>{formatSize(entry.size)}</span>
              )}
            </span>
            {!isDir && (
              <button
                onClick={(e) => { e.stopPropagation(); toggle(childPath) }}
                title={isStarred(childPath) ? 'Unstar' : 'Star'}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: 11,
                  color: isStarred(childPath) ? '#f59e0b' : (isSelected ? 'rgba(255,255,255,0.4)' : 'var(--text-muted)'),
                  opacity: isStarred(childPath) ? 1 : 0.4, flexShrink: 0, lineHeight: 1,
                }}
              >★</button>
            )}
          </div>
          {isDir && isExpanded && renderEntries(childPath, depth + 1)}
        </div>
      )
    })
  }

  return (
    <aside
      style={{
        width: 260,
        borderRight: '1px solid var(--border)',
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
        position: 'fixed' as const,
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 100,
        transform: `translateX(${isOpen ? 0 : -260}px)`,
        transition: 'transform 0.25s ease',
      }}
    >
      {/* Bots nav link */}
      <div
        onClick={() => { void navigate('/bots'); onClose() }}
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: currentPage === 'bots' ? 'default' : 'pointer',
          flexShrink: 0,
          userSelect: 'none',
          background: currentPage === 'bots' ? 'var(--accent)' : 'transparent',
        }}
      >
        <span style={{ fontSize: 15 }}>🤖</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: currentPage === 'bots' ? '#fff' : 'var(--text)' }}>Bots</span>
      </div>

      {/* Starred section */}
      {starred.length > 0 && (
        <div style={{ borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ padding: '6px 12px 2px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            ★ Starred
          </div>
          {starred.map((path) => {
            const name = path.split('/').pop() ?? path
            const isSelected = selectedFile === path
            return (
              <div
                key={path}
                onClick={() => { void navigate(`/files/${path}`); onClose() }}
                style={{
                  padding: '4px 12px 4px 20px',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                  background: isSelected ? 'var(--accent)' : 'transparent',
                  color: isSelected ? '#fff' : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  userSelect: 'none',
                }}
                title={path}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); toggle(path) }}
                  title="Unstar"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f59e0b', fontSize: 11, padding: '0 2px', flexShrink: 0 }}
                >★</button>
              </div>
            )
          })}
        </div>
      )}

      {/* Tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 4px' }}>
        <div style={{ padding: '6px 12px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Files
        </div>
        {loadingDirs.has('') ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 12, padding: '4px 12px' }}>Loading…</p>
        ) : (
          renderEntries('', 0)
        )}
      </div>
    </aside>
  )
}
