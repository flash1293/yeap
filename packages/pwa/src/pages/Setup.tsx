import { useState } from 'react'
import { postSetupInit } from '../api/orchestrator.js'
import type { SetupInitPayload } from '@yeap/shared'

const PROVIDER_MODELS: Record<string, { label: string; models: string[] }> = {
  'opencode-go': {
    label: 'OpenCode Go',
    models: [
      'opencode-go/kimi-k2.6',
      'opencode-go/kimi-k2.5',
      'opencode-go/deepseek-v4-pro',
      'opencode-go/deepseek-v4-flash',
      'opencode-go/glm-5.1',
      'opencode-go/glm-5',
      'opencode-go/mimo-v2.5-pro',
      'opencode-go/mimo-v2.5',
      'opencode-go/mimo-v2-pro',
      'opencode-go/mimo-v2-omni',
      'opencode-go/minimax-m2.7',
      'opencode-go/minimax-m2.5',
      'opencode-go/qwen3.6-plus',
      'opencode-go/qwen3.5-plus',
    ],
  },
  anthropic: {
    label: 'Anthropic',
    models: [
      'anthropic/claude-sonnet-4-5',
      'anthropic/claude-opus-4-5',
      'anthropic/claude-haiku-4-5',
    ],
  },
  openai: {
    label: 'OpenAI',
    models: ['openai/gpt-4o', 'openai/gpt-4o-mini', 'openai/o3', 'openai/o4-mini'],
  },
  google: {
    label: 'Google',
    models: [
      'google/gemini-2.5-pro',
      'google/gemini-2.5-flash',
      'google/gemini-2.0-flash',
    ],
  },
  groq: { label: 'Groq', models: [] },
  ollama: { label: 'Ollama (local)', models: [] },
}

const PROVIDER_KEYS = Object.keys(PROVIDER_MODELS)
const DEFAULT_PROVIDER = 'opencode-go'

type Props = { onComplete: () => void }

export function Setup({ onComplete }: Props) {
  const [name, setName] = useState('')
  const [provider, setProvider] = useState(DEFAULT_PROVIDER)
  const [model, setModel] = useState(PROVIDER_MODELS[DEFAULT_PROVIDER]!.models[0] ?? '')
  const [apiKey, setApiKey] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function onProviderChange(p: string) {
    setProvider(p)
    const first = PROVIDER_MODELS[p]?.models[0] ?? ''
    setModel(first)
  }

  const knownModels = PROVIDER_MODELS[provider]?.models ?? []

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Coordinator name is required.'); return }
    if (!model.trim()) { setError('Model is required.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (provider !== 'ollama' && !apiKey.trim()) { setError('API key is required for this provider.'); return }

    setLoading(true)
    try {
      const payload: SetupInitPayload = {
        coordinator_name: name.trim(),
        provider,
        model: model.trim(),
        api_key: apiKey.trim(),
        pwa_password: password,
      }
      await postSetupInit(payload)
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: 16,
      }}
    >
      <form
        onSubmit={(e) => void submit(e)}
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 32,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
          Welcome to YEAP
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Set up your coordinator bot and master password.
        </p>

        <label style={label}>
          Coordinator name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ada"
            style={input}
          />
        </label>

        <label style={label}>
          LLM Provider
          <select
            value={provider}
            onChange={(e) => onProviderChange(e.target.value)}
            style={input}
          >
            {PROVIDER_KEYS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_MODELS[p]!.label}
              </option>
            ))}
          </select>
        </label>

        <label style={label}>
          Model
          {knownModels.length > 0 ? (
            <select value={model} onChange={(e) => setModel(e.target.value)} style={input}>
              {knownModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={`e.g. ${provider}/model-name`}
              style={input}
            />
          )}
        </label>

        {provider !== 'ollama' && (
          <label style={label}>
            API Key
            {provider === 'opencode-go' && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Subscribe at{' '}
                <a href="https://opencode.ai/auth" target="_blank" rel="noreferrer"
                   style={{ color: 'var(--accent)' }}>opencode.ai/auth</a>
              </span>
            )}
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              style={input}
            />
          </label>
        )}

        <label style={label}>
          Master password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={input}
          />
        </label>

        <label style={label}>
          Confirm password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={input}
          />
        </label>

        {error && <p style={{ color: '#f87171', fontSize: 13 }}>{error}</p>}

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '10px 0',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 14,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Setting up…' : 'Initialize'}
        </button>
      </form>
    </div>
  )
}

const label: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
  color: 'var(--text-muted)',
}

const input: React.CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 14,
  fontFamily: 'inherit',
  outline: 'none',
}
