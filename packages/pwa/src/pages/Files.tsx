import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { readVirtualFile } from '../api/orchestrator.js'
import { useStarsStore } from '../store/stars.js'
import { AppSidebar } from '../components/AppSidebar.js'

export function Files() {
  const { '*': filePath } = useParams()
  const selectedFile = filePath || null
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [htmlRawMode, setHtmlRawMode] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { isStarred, toggle } = useStarsStore()

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

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 99 }}
        />
      )}

      <AppSidebar
        selectedFile={selectedFile}
        currentPage="files"
        isOpen={!isMobile || sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main content — offset by sidebar width on desktop */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, marginLeft: isMobile ? 0 : 260 }}>
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
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
