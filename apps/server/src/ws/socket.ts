import { randomUUID } from 'node:crypto'
import type { IncomingMessage, Server as HttpServer } from 'node:http'
import type { WebSocket } from 'ws'
import { WebSocketServer } from 'ws'
import {
  parseClientEvent,
  WS_UNAUTHORIZED,
  type ServerEvent,
  type User,
} from '@pm/shared'
import { verifyAccessToken } from '../auth/tokens.js'
import type { Repo, UserRecord } from '../db/repo.js'
import type { PushService } from '../push/fcm.js'
import type { Hub } from './hub.js'

const MAX_BODY = 4000
const TYPING_THROTTLE_MS = 2000

export interface SocketDeps {
  server: HttpServer
  repo: Repo
  hub: Hub
  push: PushService
  jwtSecret: string
}

function toUser(record: UserRecord): User {
  return {
    id: record.id,
    username: record.username,
    displayName: record.displayName,
    accent: record.accent,
    lastSeenAt: record.lastSeenAt,
  }
}

function send(socket: WebSocket, event: ServerEvent): void {
  if (socket.readyState !== 1) return
  try {
    socket.send(JSON.stringify(event))
  } catch {
    /* ignore: close handler cleans up */
  }
}

function preview(body: string): string {
  return body.length > 180 ? `${body.slice(0, 177)}...` : body
}

export function attachSocketServer(deps: SocketDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })

  deps.server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== '/socket') {
      socket.destroy()
      return
    }
    const claims = verifyAccessToken(url.searchParams.get('token') ?? '', deps.jwtSecret)
    wss.handleUpgrade(request, socket, head, (ws) => {
      // Completing the handshake then closing with 4401 lets clients distinguish
      // "your token is dead, sign in again" from a network failure.
      if (!claims) {
        ws.close(WS_UNAUTHORIZED, 'unauthorized')
        return
      }
      wss.emit('connection', ws, request)
    })
  })

  wss.on('connection', (ws, request) => {
    void handleConnection(ws, request, deps)
  })

  return wss
}

async function handleConnection(
  ws: WebSocket,
  request: IncomingMessage,
  deps: SocketDeps,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const claims = verifyAccessToken(url.searchParams.get('token') ?? '', deps.jwtSecret)
  if (!claims) {
    ws.close(WS_UNAUTHORIZED, 'unauthorized')
    return
  }

  const user = await deps.repo.findUserById(claims.sub)
  if (!user) {
    ws.close(WS_UNAUTHORIZED, 'unauthorized')
    return
  }

  const socketId = randomUUID()
  const conversations = await deps.repo.listConversations(user.id)
  const conversationIds = new Set(conversations.map((conversation) => conversation.id))

  deps.hub.add({ socketId, userId: user.id, socket: ws, conversationIds })

  const cursors: Record<string, number> = {}
  for (const conversation of conversations) {
    cursors[conversation.id] = conversation.lastMessage?.id ?? 0
  }
  send(ws, { t: 'ready', user: toUser(user), conversations, cursors })
  deps.hub.broadcastToConversations(conversationIds, {
    t: 'presence',
    userId: user.id,
    online: true,
    lastSeenAt: null,
  })

  const typingTimers = new Map<string, number>()

  async function onFrame(raw: string): Promise<void> {
    const event = parseClientEvent(raw)
    if (!event) return

    if (event.t === 'ping') {
      send(ws, { t: 'pong', ts: event.ts })
      return
    }

    if (event.t === 'typing') {
      if (!(await deps.repo.isMember(event.conversationId, user!.id))) return
      const previous = typingTimers.get(event.conversationId) ?? 0
      if (event.state && Date.now() - previous < TYPING_THROTTLE_MS) return
      typingTimers.set(event.conversationId, Date.now())
      deps.hub.broadcastToConversation(
        event.conversationId,
        { t: 'typing', conversationId: event.conversationId, userId: user!.id, state: event.state },
        socketId,
      )
      return
    }

    if (event.t === 'read') {
      if (!(await deps.repo.isMember(event.conversationId, user!.id))) return
      await deps.repo.markRead(event.conversationId, user!.id, event.messageId)
      deps.hub.broadcastToConversation(
        event.conversationId,
        {
          t: 'read',
          conversationId: event.conversationId,
          userId: user!.id,
          messageId: event.messageId,
        },
        socketId,
      )
      return
    }

    // event.t === 'send'
    const body = event.body.trim()
    if (!body || body.length > MAX_BODY) {
      send(ws, { t: 'error', code: 'VALIDATION', clientId: event.clientId })
      return
    }
    if (!(await deps.repo.isMember(event.conversationId, user!.id))) {
      send(ws, { t: 'error', code: 'NOT_A_MEMBER', clientId: event.clientId })
      return
    }

    const { message, duplicate } = await deps.repo.insertMessage({
      conversationId: event.conversationId,
      senderId: user!.id,
      body,
      clientId: event.clientId,
    })

    // The row is durable before anyone is told it exists, and the sender learns
    // the server id here, which is what resolves their optimistic bubble.
    send(ws, { t: 'ack', clientId: event.clientId, message })
    if (duplicate) return

    deps.hub.broadcastToConversation(event.conversationId, { t: 'msg', message }, socketId)

    const memberIds = await deps.repo.memberIds(event.conversationId)
    const offline = memberIds.filter((id) => id !== user!.id && !deps.hub.isOnline(id))
    if (offline.length === 0) return

    const tokens = await deps.repo.androidTokensForUsers(offline)
    if (tokens.length === 0) return
    void deps.push.sendMessage(
      tokens.map((entry) => entry.token),
      {
        title: user!.displayName,
        body: preview(body),
        conversationId: message.conversationId,
        messageId: message.id,
      },
    )
  }

  ws.on('message', (raw) => {
    void onFrame(raw.toString()).catch(() => {
      send(ws, { t: 'error', code: 'INTERNAL' })
    })
  })

  ws.on('error', () => {
    ws.close()
  })

  ws.on('close', () => {
    void (async () => {
      deps.hub.remove(socketId)
      const seenAt = Date.now()
      await deps.repo.setLastSeen(user.id, seenAt)
      if (!deps.hub.isOnline(user.id)) {
        deps.hub.broadcastToConversations(conversationIds, {
          t: 'presence',
          userId: user.id,
          online: false,
          lastSeenAt: seenAt,
        })
      }
    })()
  })
}
