import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AuthSession,
  ConversationSummary,
  Message,
  TransportStatus,
} from '@pm/shared'
import type { Runtime } from './runtime'

export type MessageState = 'pending' | 'sent' | 'failed'

export interface ChatMessage extends Message {
  state?: MessageState
}

export interface ChatController {
  status: TransportStatus
  conversations: ConversationSummary[]
  messages: Record<string, ChatMessage[]>
  typing: Record<string, string[]>
  online: Record<string, boolean>
  activeId: string | null
  unread: Record<string, number>
  error: string | null
  select(conversationId: string | null): void
  send(body: string): void
  startDirectMessage(userId: string): Promise<void>
  notifyTyping(): void
}

function newClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function useChat(
  runtime: Runtime,
  session: AuthSession,
  options: { autoSelectFirst?: boolean } = {},
): ChatController {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({})
  const [typing, setTyping] = useState<Record<string, string[]>>({})
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [online, setOnline] = useState<Record<string, boolean>>({})
  const [status, setStatus] = useState<TransportStatus>('idle')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const activeRef = useRef<string | null>(null)
  const loadedRef = useRef<Set<string>>(new Set())
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const lastTypingSent = useRef(0)
  const autoSelectRef = useRef(options.autoSelectFirst ?? false)
  const userId = session.user.id

  useEffect(() => {
    activeRef.current = activeId
  }, [activeId])

  const loadConversation = useCallback(
    async (conversationId: string): Promise<void> => {
      if (loadedRef.current.has(conversationId)) return
      loadedRef.current.add(conversationId)
      try {
        const page = await runtime.api.messages(conversationId, undefined, 60)
        setMessages((previous) => {
          const existing = previous[conversationId] ?? []
          const optimistic = existing.filter((message) => message.state === 'pending' || message.state === 'failed')
          return { ...previous, [conversationId]: [...page.messages, ...optimistic] }
        })
      } catch {
        loadedRef.current.delete(conversationId)
      }
    },
    [runtime],
  )

  const select = useCallback(
    (conversationId: string | null): void => {
      setActiveId(conversationId)
      activeRef.current = conversationId
      if (!conversationId) return
      void loadConversation(conversationId)
      setUnread((previous) => ({ ...previous, [conversationId]: 0 }))
      setConversations((previous) => {
        const target = previous.find((conversation) => conversation.id === conversationId)
        if (target?.lastMessage) {
          runtime.transport.send({
            t: 'read',
            conversationId,
            messageId: target.lastMessage.id,
          })
        }
        return previous
      })
    },
    [loadConversation, runtime],
  )

  useEffect(() => {
    const appendMessage = (message: Message): void => {
      setMessages((previous) => {
        const list = previous[message.conversationId] ?? []
        if (list.some((existing) => existing.id === message.id && message.id > 0)) return previous
        const withoutOptimistic = list.filter(
          (existing) => !(message.clientId && existing.clientId === message.clientId && existing.state === 'pending'),
        )
        return { ...previous, [message.conversationId]: [...withoutOptimistic, message] }
      })
      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.id === message.conversationId
            ? { ...conversation, lastMessage: message }
            : conversation,
        ),
      )
    }

    const offStatus = runtime.transport.onStatus(setStatus)
    const offEvent = runtime.transport.onEvent((event) => {
      switch (event.t) {
        case 'ready': {
          setConversations(event.conversations)
          setUnread(
            Object.fromEntries(event.conversations.map((conversation) => [conversation.id, conversation.unreadCount])),
          )
          const first = event.conversations[0]
          if (first && autoSelectRef.current && !activeRef.current) select(first.id)
          break
        }
        case 'msg': {
          appendMessage(event.message)
          if (activeRef.current === event.message.conversationId) {
            runtime.transport.send({
              t: 'read',
              conversationId: event.message.conversationId,
              messageId: event.message.id,
            })
          } else if (event.message.senderId !== userId) {
            setUnread((previous) => ({
              ...previous,
              [event.message.conversationId]: (previous[event.message.conversationId] ?? 0) + 1,
            }))
          }
          break
        }
        case 'ack': {
          appendMessage(event.message)
          break
        }
        case 'typing': {
          const key = `${event.conversationId}:${event.userId}`
          setTyping((previous) => {
            const list = previous[event.conversationId] ?? []
            if (event.state) {
              return list.includes(event.userId)
                ? previous
                : { ...previous, [event.conversationId]: [...list, event.userId] }
            }
            return { ...previous, [event.conversationId]: list.filter((id) => id !== event.userId) }
          })
          const existingTimer = typingTimers.current.get(key)
          if (existingTimer) clearTimeout(existingTimer)
          if (event.state) {
            typingTimers.current.set(
              key,
              setTimeout(() => {
                setTyping((previous) => ({
                  ...previous,
                  [event.conversationId]: (previous[event.conversationId] ?? []).filter((id) => id !== event.userId),
                }))
                typingTimers.current.delete(key)
              }, 4500),
            )
          }
          break
        }
        case 'presence': {
          setOnline((previous) => ({ ...previous, [event.userId]: event.online }))
          setConversations((previous) =>
            previous.map((conversation) => ({
              ...conversation,
              members: conversation.members.map((member) =>
                member.id === event.userId
                  ? { ...member, lastSeenAt: event.online ? null : event.lastSeenAt }
                  : member,
              ),
            })),
          )
          break
        }
        case 'read': {
          setConversations((previous) =>
            previous.map((conversation) =>
              conversation.id === event.conversationId
                ? {
                    ...conversation,
                    members: conversation.members.map((member) =>
                      member.id === event.userId
                        ? { ...member, seenAt: event.messageId } as never
                        : member,
                    ),
                  }
                : conversation,
            ),
          )
          break
        }
        case 'error': {
          if (event.clientId) {
            setMessages((previous) => {
              const next = { ...previous }
              for (const [conversationId, list] of Object.entries(next)) {
                next[conversationId] = list.map((message) =>
                  message.clientId === event.clientId ? { ...message, state: 'failed' } : message,
                )
              }
              return next
            })
          }
          setError(event.code)
          break
        }
        default:
          break
      }
    })

    runtime.transport.connect()
    return () => {
      offStatus()
      offEvent()
      runtime.transport.disconnect()
    }
  }, [runtime, select, userId])

  useEffect(() => {
    const total = Object.values(unread).reduce((sum, value) => sum + value, 0)
    runtime.unreadTotal?.(total)
  }, [runtime, unread])

  useEffect(
    () => () => {
      for (const timer of typingTimers.current.values()) clearTimeout(timer)
      typingTimers.current.clear()
    },
    [],
  )

  const send = useCallback(
    (body: string): void => {
      const conversationId = activeRef.current
      const text = body.trim()
      if (!conversationId || !text) return
      const clientId = newClientId()
      const optimistic: ChatMessage = {
        id: 0,
        conversationId,
        senderId: userId,
        body: text,
        createdAt: Date.now(),
        clientId,
        state: 'pending',
      }
      setMessages((previous) => ({
        ...previous,
        [conversationId]: [...(previous[conversationId] ?? []), optimistic],
      }))
      runtime.transport.send({ t: 'send', clientId, conversationId, body: text })
    },
    [runtime, userId],
  )

  const notifyTyping = useCallback((): void => {
    const conversationId = activeRef.current
    if (!conversationId) return
    const now = Date.now()
    if (now - lastTypingSent.current < 3000) return
    lastTypingSent.current = now
    runtime.transport.send({ t: 'typing', conversationId, state: true })
  }, [runtime])

  const startDirectMessage = useCallback(
    async (otherUserId: string): Promise<void> => {
      const { conversation } = await runtime.api.openDirectMessage(otherUserId)
      setConversations((previous) =>
        previous.some((existing) => existing.id === conversation.id)
          ? previous
          : [conversation, ...previous],
      )
      select(conversation.id)
    },
    [runtime, select],
  )

  return {
    status,
    conversations,
    messages,
    typing,
    online,
    activeId,
    unread,
    error,
    select,
    send,
    startDirectMessage,
    notifyTyping,
  }
}
