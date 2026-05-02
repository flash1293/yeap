import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { listVirtualFiles, readVirtualFile } from '../api/orchestrator.js'
import type { FileEntry } from '../api/orchestrator.js'

type TreeCache = Map<string, FileEntry[]>

function formatSize(bytes: number): string {
  if (bytes === 0) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}

export function Files() {
  const navigate = useNavigate()
  const [cache, setCache] = useState<TreeCache>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)

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

  async function handleFileClick(path: string) {
    setSelectedFile(path)
    setLoadingContent(true)
    setFileContent(null)
    try {
      const content = await readVirtualFile(path)
      setFileContent(content)
    } catch {
      setFileContent('[Error loading file]')
    } finally {
      setLoadingContent(false)
    }
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
            onClick={() =>
              isDir ? void handleDirClick(childPath) : void handleFileClick(childPath)
            }
            style={{
              paddingLeft: depth * 16 + 8,
              paddingRight: 8,
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
          </div>
          {isDir && isExpanded && renderEntries(childPath, depth + 1)}
        </div>
      )
    })
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
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => void navigate('/chat')}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 13,
            padding: 0,
          }}
        >
          ← Chat
        </button>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Files</span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Tree panel */}
        <div
          style={{
            width: 260,
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            overflowY: 'auto',
            background: 'var(--surface)',
            padding: '8px 4px',
          }}
        >
          {loadingDirs.has('') ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 12, padding: '4px 12px' }}>Loading…</p>
          ) : (
            renderEntries('', 0)
          )}
        </div>

        {/* Content panel */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, minWidth: 0 }}>
          {!selectedFile && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              Select a file in the tree to view its contents.
            </p>
          )}
          {selectedFile && (
            <>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  marginBottom: 12,
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                }}
              >
                {selectedFile}
              </div>
              {loadingContent && (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
              )}
              {!loadingContent && fileContent !== null && (
                <pre
                  style={{
                    fontSize: 12,
                    fontFamily: 'monospace',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    color: 'var(--text)',
                    margin: 0,
                    lineHeight: 1.6,
                  }}
                >
                  {fileContent}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
