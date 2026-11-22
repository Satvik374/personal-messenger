import { WS_UNAUTHORIZED, type ClientEvent, type ServerEvent } from './protocol.js'

export type TransportStatus = 'idle' | 'connecting' | 'online' | 'offline'

/**
 * The UI talks to the server through this interface. On Android a real websocket
 * implements it; on desktop the Electron main process owns the socket and bridges
 * the same events over IPC.
 */
export interface ChatTransport {
  connect(): void
  disconnect(): void
  send(event: ClientEvent): void
  onEvent(handler: (event: ServerEvent) => void): () => void
  onStatus(handler: (status: TransportStatus) => void): () => void
  status(): TransportStatus
}

export interface WebSocketTransportOptions {
  url: string
  getAccessToken(): string | null
  onUnauthorized(): void
  heartbeatMs?: number
  maxQueue?: number
}

export function createWebSocketTransport(options: WebSocketTransportOptions): ChatTransport {
  const heartbeatMs = options.heartbeatMs ?? 25_000
  const maxQueue = options.maxQueue ?? 50
  const listeners = new Set<(event: ServerEvent) => void>()
  const statusListeners = new Set<(status: TransportStatus) => void>()
  const queue: ClientEvent[] = []

  let socket: WebSocket | null = null
  let currentStatus: TransportStatus = 'idle'
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let stopped = true

  function setStatus(next: TransportStatus): void {
    if (currentStatus === next) return
    currentStatus = next
    for (const listener of statusListeners) listener(next)
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  function startHeartbeat(): void {
    stopHeartbeat()
    heartbeatTimer = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ t: 'ping', ts: Date.now() } satisfies ClientEvent))
      }
    }, heartbeatMs)
  }

  function flush(): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    while (queue.length > 0) {
      const event = queue.shift()
      if (event) socket.send(JSON.stringify(event))
    }
  }

  function scheduleReconnect(): void {
    if (stopped) return
    if (reconnectTimer) clearTimeout(reconnectTimer)
    const backoff = Math.min(30_000, 1000 * 2 ** attempt)
    const delay = backoff + Math.floor(Math.random() * 400)
    attempt += 1
    setStatus('offline')
    reconnectTimer = setTimeout(open, delay)
  }

  function open(): void {
    if (stopped) return
    const token = options.getAccessToken()
    if (!token) {
      scheduleReconnect()
      return
    }
    setStatus('connecting')
    const separator = options.url.includes('?') ? '&' : '?'
    let ws: WebSocket
    try {
      ws = new WebSocket(`${options.url}${separator}token=${encodeURIComponent(token)}`)
    } catch {
      scheduleReconnect()
      return
    }
    socket = ws

    ws.onopen = () => {
      attempt = 0
      setStatus('online')
      startHeartbeat()
      flush()
    }

    ws.onmessage = (event) => {
      let parsed: ServerEvent
      try {
        parsed = JSON.parse(String(event.data)) as ServerEvent
      } catch {
        return
      }
      for (const listener of listeners) listener(parsed)
    }

    ws.onclose = (event) => {
      stopHeartbeat()
      socket = null
      if (event.code === WS_UNAUTHORIZED) {
        stopped = true
        setStatus('offline')
        options.onUnauthorized()
        return
      }
      scheduleReconnect()
    }

    ws.onerror = () => {
      /* onclose carries the actionable signal */
    }
  }

  return {
    connect() {
      if (!stopped) return
      stopped = false
      attempt = 0
      open()
    },
    disconnect() {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = null
      stopHeartbeat()
      queue.length = 0
      const active = socket
      socket = null
      if (active && active.readyState <= WebSocket.OPEN) active.close(1000, 'client disconnect')
      setStatus('idle')
    },
    send(event) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(event))
        return
      }
      queue.push(event)
      if (queue.length > maxQueue) queue.shift()
    },
    onEvent(handler) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
    onStatus(handler) {
      statusListeners.add(handler)
      return () => statusListeners.delete(handler)
    },
    status() {
      return currentStatus
    },
  }
}
