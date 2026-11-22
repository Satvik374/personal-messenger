import type { ConversationSummary, Message, User } from './types.js'

/** Frames sent by a client over the websocket. */
export type ClientEvent =
  | { t: 'send'; clientId: string; conversationId: string; body: string }
  | { t: 'typing'; conversationId: string; state: boolean }
  | { t: 'read'; conversationId: string; messageId: number }
  | { t: 'ping'; ts: number }

/** Frames sent by the server over the websocket. */
export type ServerEvent =
  | {
      t: 'ready'
      user: User
      conversations: ConversationSummary[]
      cursors: Record<string, number>
    }
  | { t: 'ack'; clientId: string; message: Message }
  | { t: 'msg'; message: Message }
  | { t: 'typing'; conversationId: string; userId: string; state: boolean }
  | { t: 'read'; conversationId: string; userId: string; messageId: number }
  | { t: 'presence'; userId: string; online: boolean; lastSeenAt: number | null }
  | { t: 'pong'; ts: number }
  | { t: 'error'; code: string; message?: string; clientId?: string }

/** Websocket close code used when the access token is missing or invalid. */
export const WS_UNAUTHORIZED = 4401

export function parseClientEvent(raw: string): ClientEvent | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const event = value as Record<string, unknown>
  switch (event.t) {
    case 'send':
      if (
        typeof event.clientId === 'string' &&
        typeof event.conversationId === 'string' &&
        typeof event.body === 'string'
      ) {
        return {
          t: 'send',
          clientId: event.clientId,
          conversationId: event.conversationId,
          body: event.body,
        }
      }
      return null
    case 'typing':
      if (typeof event.conversationId === 'string' && typeof event.state === 'boolean') {
        return { t: 'typing', conversationId: event.conversationId, state: event.state }
      }
      return null
    case 'read':
      if (typeof event.conversationId === 'string' && typeof event.messageId === 'number') {
        return { t: 'read', conversationId: event.conversationId, messageId: event.messageId }
      }
      return null
    case 'ping':
      return { t: 'ping', ts: typeof event.ts === 'number' ? event.ts : Date.now() }
    default:
      return null
  }
}
