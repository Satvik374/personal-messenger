import type {
  ApiClient,
  AppSettings,
  AuthSession,
  ChatTransport,
  ConversationSummary,
  MessagePage,
  Platform,
} from '@pm/shared'

export interface SettingsStore {
  get(): Promise<AppSettings>
  patch(next: Partial<AppSettings>): Promise<AppSettings>
}

/**
 * The subset of server calls the UI performs. `ApiClient` satisfies it directly
 * on web/Android; on desktop the same shape is proxied to the main process, which
 * owns the only token-refresh loop so refresh rotation is never raced.
 */
export interface ChatApi {
  login(username: string, password: string): Promise<AuthSession>
  register(input: {
    inviteCode: string
    username: string
    password: string
    displayName: string
  }): Promise<AuthSession>
  logout(): Promise<unknown>
  messages(conversationId: string, before?: number, limit?: number): Promise<MessagePage>
  openDirectMessage(userId: string): Promise<{ conversation: ConversationSummary }>
}

export type ApiClientLike = ApiClient | ChatApi

export interface Runtime {
  platform: Platform
  api: ChatApi
  transport: ChatTransport
  loadSession(): Promise<AuthSession | null>
  saveSession(session: AuthSession | null): Promise<void>
  settings: SettingsStore
  unreadTotal?(count: number): void
  /** Android registers its FCM token here once signed in. */
  registerPush?(): Promise<void>
}
