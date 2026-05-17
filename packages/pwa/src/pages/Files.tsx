import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { listVirtualFiles, readVirtualFile, sendDashboardMessage } from '../api/orchestrator.js'
import type { FileEntry } from '../api/orchestrator.js'
import { useStarsStore } from '../store/stars.js'

type TreeCache = Map<string, FileEntry[]>

function formatSize(bytes: number): string {
  if (bytes === 0) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}

export function Files() {
  const navigate = useNavigate()
  const { '*': filePath } = useParams()
  const selectedFile = filePath || null
  const [cache, setCache] = useState<TreeCache>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [htmlRawMode, setHtmlRawMode] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { starred, toggle, isStarred } = useStarsStore()

  const loadDir = useCallback(
    async (path: string) => {
      if (cache.has(path)) return
      setLoadingDirs((s) => new Set(s).add(path))
      try {
        const entries = await listVirtualFiles(path)
        // Sort: dirs first, then files, both alphabetically
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
    setExpanded(new Set(['']))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // When a file is linked directly, expand all ancestor dirs and load its content
  useEffect(() => {
    if (!selectedFile) return
    // Expand every ancestor segment
    const parts = selectedFile.split('/')
    const ancestors = parts.map((_, i) => parts.slice(0, i).join('/')).filter((_, i) => i <= parts.length - 1)
    setExpanded((s) => {
      const n = new Set(s)
      for (const a of ancestors) n.add(a)
      return n
    })
    // Ensure each ancestor dir is loaded
    void (async () => {
      for (const a of ancestors) {
        await loadDir(a)
      }
    })()
  }, [selectedFile]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load file content whenever selectedFile changes
  useEffect(() => {
    if (!selectedFile) { setFileContent(null); return }
    setLoadingContent(true)
    setFileContent(null)
    setHtmlRawMode(false)
    void readVirtualFile(selectedFile)
      .then(setFileContent)
      .catch(() => setFileContent('[Error loading file]'))
      .finally(() => setLoadingContent(false))
  }, [selectedFile])

  // Track viewport width
  useEffect(() => {
    function onResize() {
      const mobile = window.innerWidth < 640
      setIsMobile(mobile)
      if (!mobile) setSidebarOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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
      setExpanded((s) => {
        const n = new Set(s)
        n.delete(path)
        return n
      })
    } else {
      setExpanded((s) => new Set(s).add(path))
      await loadDir(path)
    }
  }

  function handleFileClick(path: string) {
    void navigate(`/files/${path}`)
  }

  function renderEntries(parentPath: string, depth: number): React.ReactNode {
    const entries = cache.get(parentPath)
    if (!entries) return null
    if (entries.length === 0) {
      return (
        <div
          style={{
            paddingLeft: depth * 16 + 24,
            paddingTop: 2,
            paddingBottom: 2,
            fontSize: 11,
            color: 'var(--text-muted)',
            fontFamily: 'monospace',
            opacity: 0.6,
          }}
        >
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
                {entry.name}
                {isDir ? '/' : ''}
              </span>
              {!isDir && entry.size > 0 && (
                <span style={{ opacity: 0.4, fontSize: 10, flexShrink: 0 }}>
                  {formatSize(entry.size)}
                </span>
              )}
            </span>
            {!isDir && (
              <button
                onClick={(e) => { e.stopPropagation(); toggle(childPath) }}
                title={isStarred(childPath) ? 'Unstar' : 'Star'}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0 2px',
                  fontSize: 11,
                  color: isStarred(childPath) ? '#f59e0b' : (isSelected ? 'rgba(255,255,255,0.4)' : 'var(--text-muted)'),
                  opacity: isStarred(childPath) ? 1 : 0.4,
                  flexShrink: 0,
                  lineHeight: 1,
                }}
              >
                ★
              </button>
            )}
          </div>
          {isDir && isExpanded && renderEntries(childPath, depth + 1)}
        </div>
      )
    })
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 99 }}
        />
      )}

      {/* Sidebar */}
      <aside
        style={{
          width: 260,
          borderRight: '1px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          flexShrink: 0,
          ...(isMobile
            ? {
                position: 'fixed',
                top: 0,
                left: 0,
                bottom: 0,
                zIndex: 100,
                transform: `translateX(${sidebarOpen ? 0 : -260}px)`,
                transition: 'transform 0.25s ease',
              }
            : {}),
        }}
      >
        {/* Sidebar header */}
        <div
          style={{
            padding: '12px 16px',
            fontWeight: 700,
            fontSize: 16,
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          Files
          <button
            onClick={() => void navigate('/bots')}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}
          >
            ← Bots
          </button>
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
                  onClick={() => { void navigate(`/files/${path}`); if (isMobile) setSidebarOpen(false) }}
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
                  >
                    ★
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Tree */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 4px' }}>
          {loadingDirs.has('') ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 12, padding: '4px 12px' }}>Loading…</p>
          ) : (
            renderEntries('', 0)
          )}
        </div>
      </aside>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Top bar */}
        <div
          style={{
            padding: '10px 12px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
          }}
        >
          {isMobile && (
            <button
              onClick={() => setSidebarOpen(true)}
              style={{ background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px' }}
              aria-label="Open file tree"
            >
              ☰
            </button>
          )}
          <span
            style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {selectedFile ?? '/'}
          </span>
          {selectedFile && (
            <button
              onClick={() => toggle(selectedFile)}
              title={isStarred(selectedFile) ? 'Unstar' : 'Star this file'}
              style={{
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 4,
                cursor: 'pointer',
                padding: '3px 8px',
                fontSize: 13,
                color: isStarred(selectedFile) ? '#f59e0b' : 'var(--text-muted)',
                flexShrink: 0,
              }}
            >
              {isStarred(selectedFile) ? '★' : '☆'}
            </button>
          )}
          {selectedFile?.endsWith('.html') && fileContent !== null && (
            <button
              onClick={() => setHtmlRawMode((v) => !v)}
              style={{
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 11,
                padding: '2px 8px',
                flexShrink: 0,
              }}
            >
              {htmlRawMode ? 'Rendered' : 'Raw'}
            </button>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {!selectedFile && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: 16 }}>
              Select a file in the tree to view its contents.
            </p>
          )}
          {selectedFile && loadingContent && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: 16 }}>Loading…</p>
          )}
          {selectedFile && !loadingContent && fileContent !== null && selectedFile.endsWith('.html') && !htmlRawMode ? (
            <iframe
              srcDoc={fileContent}
              sandbox="allow-scripts"
              style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
              title={selectedFile}
            />
          ) : (
            selectedFile && !loadingContent && fileContent !== null && (
              <pre
                style={{
                  fontSize: 12,
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  color: 'var(--text)',
                  margin: 0,
                  lineHeight: 1.6,
                  padding: 16,
                  overflowY: 'auto',
                  height: '100%',
                  boxSizing: 'border-box',
                }}
              >
                {fileContent}
              </pre>
            )
          )}
        </div>
      </div>
    </div>
  )
}
