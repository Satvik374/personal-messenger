import { WebSocket } from 'ws'
import type { ServerEvent } from '@pm/shared'

export interface HubClient {
  socketId: string
  userId: string
  socket: WebSocket
  conversationIds: Set<string>
}

export class Hub {
  private readonly clients = new Map<string, HubClient>()

  add(client: HubClient): void {
    this.clients.set(client.socketId, client)
  }

  remove(socketId: string): HubClient | undefined {
    const client = this.clients.get(socketId)
    this.clients.delete(socketId)
    return client
  }

  attachConversation(socketId: string, conversationId: string): void {
    this.clients.get(socketId)?.conversationIds.add(conversationId)
  }

  isOnline(userId: string): boolean {
    for (const client of this.clients.values()) {
      if (client.userId === userId) return true
    }
    return false
  }

  onlineUserIds(): string[] {
    const ids = new Set<string>()
    for (const client of this.clients.values()) ids.add(client.userId)
    return [...ids]
  }

  sendToSocket(socketId: string, event: ServerEvent): void {
    const client = this.clients.get(socketId)
    if (client) send(client.socket, event)
  }

  sendToUser(userId: string, event: ServerEvent): void {
    for (const client of this.clients.values()) {
      if (client.userId === userId) send(client.socket, event)
    }
  }

  /** Sends to every socket that is a member of the conversation, optionally skipping one. */
  broadcastToConversation(
    conversationId: string,
    event: ServerEvent,
    exceptSocketId?: string,
  ): void {
    for (const client of this.clients.values()) {
      if (client.socketId === exceptSocketId) continue
      if (client.conversationIds.has(conversationId)) send(client.socket, event)
    }
  }

  /** Sends to any socket sharing at least one of the given conversations (presence fan-out). */
  broadcastToConversations(conversationIds: Iterable<string>, event: ServerEvent): void {
    const wanted = new Set(conversationIds)
    if (wanted.size === 0) return
    for (const client of this.clients.values()) {
      for (const id of client.conversationIds) {
        if (wanted.has(id)) {
          send(client.socket, event)
          break
        }
      }
    }
  }
}

function send(socket: WebSocket, event: ServerEvent): void {
  if (socket.readyState !== WebSocket.OPEN) return
  try {
    socket.send(JSON.stringify(event))
  } catch {
    /* a dead socket is cleaned up by its close handler */
  }
}
