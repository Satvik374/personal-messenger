import type {
  AuthSession,
  ConversationListResult,
  ConversationSummary,
  MessagePage,
  Platform,
  SyncResult,
  TokenPair,
  User,
} from './types.js'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message?: string) {
    super(message ?? code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export interface ApiClientOptions {
  baseUrl: string
  platform: Platform
  getTokens(): TokenPair | null
  setTokens(tokens: TokenPair | null): void
  onSignedOut?(): void
}

type Body = Record<string, unknown>

/**
 * Thin JSON client. Handles bearer auth and a single transparent refresh on 401,
 * so callers never see an expired access token.
 */
export class ApiClient {
  private refreshing: Promise<boolean> | null = null

  constructor(private readonly opts: ApiClientOptions) {}

  private url(path: string): string {
    return `${this.opts.baseUrl.replace(/\/+$/, '')}${path}`
  }

  private async raw<T>(
    path: string,
    init: RequestInit & { auth?: boolean } = {},
  ): Promise<T> {
    const headers = new Headers(init.headers)
    if (init.body) headers.set('content-type', 'application/json')
    if (init.auth !== false) {
      const tokens = this.opts.getTokens()
      if (tokens) headers.set('authorization', `Bearer ${tokens.accessToken}`)
    }

    const res = await fetch(this.url(path), { ...init, headers })
    const text = await res.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }
    }

    if (!res.ok) {
      const errorBody = (parsed ?? {}) as { error?: { code?: string; message?: string } }
      throw new ApiError(
        res.status,
        errorBody.error?.code ?? `HTTP_${res.status}`,
        errorBody.error?.message,
      )
    }
    return parsed as T
  }

  private async request<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
    try {
      return await this.raw<T>(path, init)
    } catch (err) {
      const retryable = err instanceof ApiError && err.status === 401 && init.auth !== false
      if (retryable && (await this.refresh())) {
        return this.raw<T>(path, init)
      }
      throw err
    }
  }

  private refresh(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null
      })
    }
    return this.refreshing
  }

  private async doRefresh(): Promise<boolean> {
    const tokens = this.opts.getTokens()
    if (!tokens?.refreshToken) return false
    try {
      const next = await this.raw<TokenPair>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
        auth: false,
      })
      this.opts.setTokens(next)
      return true
    } catch {
      this.opts.setTokens(null)
      this.opts.onSignedOut?.()
      return false
    }
  }

  private post<T>(path: string, body: Body, auth = true): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body), auth })
  }

  login(username: string, password: string): Promise<AuthSession> {
    return this.post<AuthSession>(
      '/auth/login',
      { username, password, platform: this.opts.platform },
      false,
    )
  }

  register(input: {
    inviteCode: string
    username: string
    password: string
    displayName: string
  }): Promise<AuthSession> {
    return this.post<AuthSession>('/auth/register', input, false)
  }

  logout(): Promise<{ ok: true }> {
    const tokens = this.opts.getTokens()
    return this.post<{ ok: true }>('/auth/logout', { refreshToken: tokens?.refreshToken ?? '' })
  }

  me(): Promise<{ user: User }> {
    return this.request<{ user: User }>('/me')
  }

  conversations(): Promise<ConversationListResult> {
    return this.request<ConversationListResult>('/conversations')
  }

  messages(conversationId: string, before?: number, limit = 50): Promise<MessagePage> {
    const params = new URLSearchParams({ conversationId, limit: String(limit) })
    if (before !== undefined) params.set('before', String(before))
    return this.request<MessagePage>(`/messages?${params.toString()}`)
  }

  sync(since: number, conversationId?: string): Promise<SyncResult> {
    const params = new URLSearchParams({ since: String(since) })
    if (conversationId) params.set('conversationId', conversationId)
    return this.request<SyncResult>(`/sync?${params.toString()}`)
  }

  openDirectMessage(userId: string): Promise<{ conversation: ConversationSummary }> {
    return this.post<{ conversation: ConversationSummary }>('/conversations/dm', { userId })
  }

  renameGroup(conversationId: string, title: string): Promise<{ ok: true }> {
    return this.post<{ ok: true }>('/conversations/title', { conversationId, title })
  }

  registerDevice(platform: Platform, fcmToken: string | null): Promise<{ ok: true }> {
    return this.post<{ ok: true }>('/devices', { platform, fcmToken })
  }

  health(): Promise<{ ok: true; uptime: number }> {
    return this.request<{ ok: true; uptime: number }>('/healthz', { auth: false })
  }
}
