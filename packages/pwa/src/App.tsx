import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { getSetupStatus } from './api/orchestrator.js'
import { useAuthStore } from './store/auth.js'
import { Setup } from './pages/Setup.js'
import { Login } from './pages/Login.js'
import { Chat } from './pages/Chat.js'
import { Bots } from './pages/Bots.js'
import { Files } from './pages/Files.js'

export function App() {
  const [initialized, setInitialized] = useState<boolean | null>(null)
  const token = useAuthStore((s) => s.token)

  useEffect(() => {
    getSetupStatus().then((s) => setInitialized(s.initialized)).catch(() => setInitialized(false))
  }, [])

  if (initialized === null) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        Loading…
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/setup"
          element={initialized ? <Navigate to="/login" /> : <Setup onComplete={() => setInitialized(true)} />}
        />
        <Route
          path="/login"
          element={
            !initialized ? (
              <Navigate to="/setup" />
            ) : token ? (
              <Navigate to="/chat" />
            ) : (
              <Login />
            )
          }
        />
        <Route
          path="/chat/*"
          element={
            !initialized ? (
              <Navigate to="/setup" />
            ) : !token ? (
              <Navigate to="/login" />
            ) : (
              <Chat />
            )
          }
        />
        <Route
          path="/bots"
          element={
            !initialized ? (
              <Navigate to="/setup" />
            ) : !token ? (
              <Navigate to="/login" />
            ) : (
              <Bots />
            )
          }
        />
        <Route
          path="/files"
          element={
            !initialized ? (
              <Navigate to="/setup" />
            ) : !token ? (
              <Navigate to="/login" />
            ) : (
              <Files />
            )
          }
        />
        <Route path="*" element={<Navigate to={initialized ? (token ? '/chat' : '/login') : '/setup'} />} />
      </Routes>
    </BrowserRouter>
  )
}
