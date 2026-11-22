/** Types shared by the server, the Electron desktop app and the Android app. */

export type Platform = 'desktop' | 'android' | 'web'

export type ConversationKind = 'dm' | 'group'

export type PopupCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface User {
  id: string
  username: string
  displayName: string
  accent: string
  lastSeenAt: number | null
}

export interface Message {
  id: number
  conversationId: string
  senderId: string
  body: string
  createdAt: number
  /** Set on messages the client itself sent, used to resolve optimistic bubbles. */
  clientId: string | null
}

export interface ConversationSummary {
  id: string
  kind: ConversationKind
  /** Null for direct messages; the client renders the other member's name instead. */
  title: string | null
  members: User[]
  lastMessage: Message | null
  lastReadMessageId: number
  unreadCount: number
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

export interface AuthSession extends TokenPair {
  user: User
}

export interface AppSettings {
  corner: PopupCorner
  popupDurationMs: number
  popupsEnabled: boolean
  startAtLogin: boolean
  /** Electron display id the popup should use; null means the primary display. */
  displayId: number | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  corner: 'top-right',
  popupDurationMs: 6000,
  popupsEnabled: true,
  startAtLogin: false,
  displayId: null,
}

export interface SyncResult {
  messages: Message[]
  hasMore: boolean
  cursor: number
}

export interface ConversationListResult {
  conversations: ConversationSummary[]
}

export interface MessagePage {
  messages: Message[]
  hasMore: boolean
}
