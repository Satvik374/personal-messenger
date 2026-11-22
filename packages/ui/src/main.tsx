import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/instrument-sans'
import { createRoot } from 'react-dom/client'
import {
  ApiClient,
  DEFAULT_SETTINGS,
  createWebSocketTransport,
  type AppSettings,
  type AuthSession,
  type TokenPair,
} from '@pm/shared'
import { App } from './App'
import type { Runtime } from './lib/runtime'

const API_OVERRIDE_KEY = 'pm.api.url'

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

/**
 * Server location, resolved at runtime so a deployed build can be repointed at
 * another server without rebuilding: ?api=<url> in the address bar, a saved
 * override, config.js next to index.html, then the build-time VITE_API_URL.
 * Passing ?api= (empty) clears the saved override.
 */
function resolveBaseUrl(): string {
  const params = new URLSearchParams(window.location.search)
  if (params.has('api')) {
    const fromQuery = normalizeBaseUrl(params.get('api') ?? '')
    try {
      if (fromQuery) localStorage.setItem(API_OVERRIDE_KEY, fromQuery)
      else localStorage.removeItem(API_OVERRIDE_KEY)
    } catch {
      /* storage can be unavailable; the query still applies for this visit */
    }
    if (fromQuery) return fromQuery
  }
  try {
    const stored = localStorage.getItem(API_OVERRIDE_KEY)
    if (stored) return normalizeBaseUrl(stored)
  } catch {
    /* fall through to build-time configuration */
  }
  const configured = (window as unknown as { __PM_API_URL__?: unknown }).__PM_API_URL__
  if (typeof configured === 'string' && configured.trim()) return normalizeBaseUrl(configured)
  return normalizeBaseUrl(import.meta.env.VITE_API_URL ?? 'http://localhost:8787')
}

const baseUrl = resolveBaseUrl()
const SESSION_KEY = 'pm.dev.session'
const SETTINGS_KEY = 'pm.dev.settings'

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

let session: AuthSession | null = readStored<AuthSession | null>(SESSION_KEY, null)

const api = new ApiClient({
  baseUrl,
  platform: 'web',
  getTokens: () =>
    session ? { accessToken: session.accessToken, refreshToken: session.refreshToken } : null,
  setTokens: (tokens: TokenPair | null) => {
    if (!tokens) {
      session = null
      localStorage.removeItem(SESSION_KEY)
      return
    }
    if (!session) return
    session = { ...session, ...tokens }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  },
  onSignedOut: () => {
    session = null
    localStorage.removeItem(SESSION_KEY)
  },
})

const transport = createWebSocketTransport({
  url: `${baseUrl.replace(/^http/, 'ws')}/socket`,
  getAccessToken: () => session?.accessToken ?? null,
  onUnauthorized: () => {
    session = null
    localStorage.removeItem(SESSION_KEY)
    window.location.reload()
  },
})

const runtime: Runtime = {
  platform: 'web',
  api,
  transport,
  async loadSession() {
    return session
  },
  async saveSession(next) {
    session = next
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next))
    else localStorage.removeItem(SESSION_KEY)
  },
  settings: {
    async get() {
      return { ...DEFAULT_SETTINGS, ...readStored<Partial<AppSettings>>(SETTINGS_KEY, {}) }
    },
    async patch(patch: Partial<AppSettings>) {
      const next = { ...DEFAULT_SETTINGS, ...readStored<Partial<AppSettings>>(SETTINGS_KEY, {}), ...patch }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
      return next
    },
  },
}

createRoot(document.getElementById('root')!).render(<App runtime={runtime} />)
