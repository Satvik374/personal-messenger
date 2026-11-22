import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ChevronLeft, Settings2, Users, X } from 'lucide-react'
import type { AppSettings, AuthSession, ConversationSummary, User } from '@pm/shared'
import { DEFAULT_SETTINGS } from '@pm/shared'
import { Avatar } from '../components/Avatar'
import { chatEvents } from '../lib/bus'
import type { Runtime } from '../lib/runtime'
import { useChat, type ChatMessage } from '../lib/useChat'

interface Props {
  runtime: Runtime
  session: AuthSession
  onSignedOut: () => Promise<void> | void
}

function titleFor(conversation: ConversationSummary, meId: string): string {
  if (conversation.kind === 'group') return conversation.title ?? 'Group'
  const other = conversation.members.find((member) => member.id !== meId)
  return other?.displayName ?? 'Direct message'
}

function otherMember(conversation: ConversationSummary, meId: string): User | null {
  return conversation.members.find((member) => member.id !== meId) ?? null
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function relative(ts: number | null): string {
  if (!ts) return 'offline'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'last seen just now'
  if (diff < 3_600_000) return `last seen ${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `last seen ${Math.floor(diff / 3_600_000)}h ago`
  return `last seen ${new Date(ts).toLocaleDateString()}`
}

export function Chat({ runtime, session, onSignedOut }: Props) {
  const chat = useChat(runtime, session, { autoSelectFirst: runtime.platform === 'desktop' })
  const [view, setView] = useState<'list' | 'thread'>('list')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const scroller = useRef<HTMLDivElement | null>(null)
  const composer = useRef<HTMLTextAreaElement | null>(null)
  const settingsRef = useRef(false)
  const meId = session.user.id

  const active = chat.conversations.find((conversation) => conversation.id === chat.activeId) ?? null
  const activeMessages = chat.activeId ? (chat.messages[chat.activeId] ?? []) : []
  const typingIds = chat.activeId ? (chat.typing[chat.activeId] ?? []) : []

  useEffect(() => {
    settingsRef.current = settingsOpen
  }, [settingsOpen])

  function narrow(): boolean {
    return window.matchMedia('(max-width: 979px)').matches
  }

  /** Opens the thread and gives Android's back gesture something to pop. */
  function openThread(conversationId: string): void {
    chat.select(conversationId)
    setView('thread')
    if (!narrow()) return
    if (window.history.state?.pmThread) window.history.replaceState({ pmThread: conversationId }, '')
    else window.history.pushState({ pmThread: conversationId }, '')
  }

  function leaveThread(): void {
    if (window.history.state?.pmThread) window.history.back()
    else setView('list')
  }

  // A hardware back on Android closes settings first, then returns to the list.
  useEffect(() => {
    const onPop = (): void => {
      if (settingsRef.current) {
        setSettingsOpen(false)
        if (view === 'thread' && chat.activeId) {
          window.history.pushState({ pmThread: chat.activeId }, '')
        }
        return
      }
      setView('list')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [chat.activeId, view])

  // Conversations opened from settings or a notification still get a back entry.
  useEffect(() => {
    if (view !== 'thread' || !chat.activeId || !narrow()) return
    if (window.history.state?.pmThread !== chat.activeId) {
      window.history.pushState({ pmThread: chat.activeId }, '')
    }
  }, [view, chat.activeId])


  useEffect(() => {
    const element = scroller.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [activeMessages.length, chat.activeId, typingIds.length])

  useEffect(() => {
    if (chat.activeId) setView('thread')
  }, [chat.activeId])

  useEffect(() => {
    const handler = (event: Event): void => {
      const conversationId = (event as CustomEvent<string>).detail
      if (!conversationId) return
      chat.select(conversationId)
      setView('thread')
    }
    chatEvents.addEventListener('open-conversation', handler)
    return () => chatEvents.removeEventListener('open-conversation', handler)
  }, [chat.select])

  const typingNames = useMemo(() => {
    if (!active || typingIds.length === 0) return ''
    const names = typingIds
      .map((id) => active.members.find((member) => member.id === id)?.displayName)
      .filter((name): name is string => Boolean(name))
    if (names.length === 0) return ''
    if (names.length === 1) return `${names[0]} is typing`
    return `${names.length} people are typing`
  }, [active, typingIds])

  function submit(): void {
    if (!draft.trim()) return
    chat.send(draft)
    setDraft('')
    if (composer.current) composer.current.style.height = 'auto'
  }

  const statusLabel =
    chat.status === 'online' ? 'connected' : chat.status === 'connecting' ? 'connecting…' : 'offline'

  return (
    <>
      <div className="shell" data-view={view}>
        <aside className="rail glass">
          <div className="rail-head">
            <span className="brand-mark" aria-hidden />
            <div className="rail-heading">
              <div className="rail-title">Chats</div>
              <span className="rail-status" data-status={chat.status} title={statusLabel}>
                <span className="status-dot" />
                {statusLabel}
              </span>
            </div>
            <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
              <Settings2 size={18} strokeWidth={1.8} />
            </button>
          </div>

          <div className="conv-list">
            {chat.conversations.length === 0 ? (
              <div className="empty-list">
                <EmptyMark />
                <span>No conversations yet. Invite a friend and say hello.</span>
              </div>
            ) : null}
            {chat.conversations.map((conversation) => {
              const other = otherMember(conversation, meId)
              const name = titleFor(conversation, meId)
              const count = chat.unread[conversation.id] ?? 0
              const last = conversation.lastMessage
              const online = other ? Boolean(chat.online[other.id]) : false
              return (
                <button
                  key={conversation.id}
                  className="conv"
                  data-active={conversation.id === chat.activeId}
                  onClick={() => {
                    openThread(conversation.id)
                  }}
                >
                  <Avatar
                    user={
                      conversation.kind === 'group'
                        ? { displayName: name, accent: '#c9a26b' }
                        : (other ?? { displayName: name, accent: '#c9a26b' })
                    }
                    online={online}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span className="conv-name" style={{ display: 'block' }}>
                      {name}
                    </span>
                    <span className="conv-preview" style={{ display: 'block' }}>
                      {last ? `${last.senderId === meId ? 'You: ' : ''}${last.body}` : 'No messages yet'}
                    </span>
                  </span>
                  <span className="conv-meta">
                    <span className="conv-time">{last ? clock(last.createdAt) : ''}</span>
                    {count > 0 ? <span className="badge">{count > 99 ? '99+' : count}</span> : null}
                  </span>
                </button>
              )
            })}
          </div>
        </aside>

        <section className="thread-pane">
          {active ? (
            <>
              <header className="thread-head">
                <button className="back" onClick={leaveThread} aria-label="Back to chats">
                  <ChevronLeft size={22} strokeWidth={1.8} />
                </button>
                <Avatar
                  size="sm"
                  user={
                    active.kind === 'group'
                      ? { displayName: titleFor(active, meId), accent: '#c9a26b' }
                      : (otherMember(active, meId) ?? { displayName: '?', accent: '#c9a26b' })
                  }
                />
                <div className="thread-identity">
                  <div className="thread-title">{titleFor(active, meId)}</div>
                  <div className="thread-sub">
                    {active.kind === 'group'
                      ? `${active.members.length} members`
                      : chat.online[otherMember(active, meId)?.id ?? '']
                        ? 'online'
                        : relative(otherMember(active, meId)?.lastSeenAt ?? null)}
                  </div>
                </div>
                <button
                  className="icon-btn"
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Settings"
                >
                  <Users size={18} strokeWidth={1.8} />
                </button>
              </header>

              <div className="messages" ref={scroller}>
                {activeMessages.length === 0 ? (
                  <div className="empty-thread">
                    <EmptyMark />
                    <p>
                      This is the beginning of your conversation with {titleFor(active, meId)}.
                      Say hello.
                    </p>
                  </div>
                ) : null}
                {activeMessages.map((message) => (
                  <MessageRow
                    key={message.clientId ?? String(message.id)}
                    message={message}
                    own={message.senderId === meId}
                    showSender={active.kind === 'group'}
                    sender={active.members.find((member) => member.id === message.senderId) ?? null}
                  />
                ))}
              </div>

              <div className="typing">
                {typingNames ? (
                  <>
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                    <span style={{ marginLeft: 6 }}>{typingNames}…</span>
                  </>
                ) : null}
              </div>

              <div className="composer">
                <textarea
                  ref={composer}
                  rows={1}
                  value={draft}
                  placeholder={`Message ${titleFor(active, meId)}`}
                  onChange={(event) => {
                    setDraft(event.target.value)
                    chat.notifyTyping()
                    const element = event.target
                    element.style.height = 'auto'
                    element.style.height = `${Math.min(element.scrollHeight, 132)}px`
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      submit()
                    }
                  }}
                />
                <button className="send" onClick={submit} disabled={!draft.trim()} aria-label="Send">
                  <ArrowUp size={20} strokeWidth={2.2} />
                </button>
              </div>
            </>
          ) : (
            <div className="empty-thread">
              <EmptyMark />
              <p>Pick a conversation to start reading.</p>
            </div>
          )}
        </section>
      </div>

      {settingsOpen ? (
        <SettingsSheet
          runtime={runtime}
          conversation={active}
          meId={meId}
          onClose={() => setSettingsOpen(false)}
          onStartDirectMessage={async (userId) => {
            await chat.startDirectMessage(userId)
            setSettingsOpen(false)
            setView('thread')
          }}
          onSignedOut={onSignedOut}
          conversations={chat.conversations}
        />
      ) : null}
    </>
  )
}

function EmptyMark() {
  return (
    <svg className="empty-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle className="ring-1" cx="32" cy="32" r="25" stroke="currentColor" strokeWidth="1" />
      <circle className="ring-2" cx="32" cy="32" r="14" stroke="currentColor" strokeWidth="1" />
      <circle className="core" cx="32" cy="32" r="3.2" />
    </svg>
  )
}

function MessageRow({
  message,
  own,
  showSender,
  sender,
}: {
  message: ChatMessage
  own: boolean
  showSender: boolean
  sender: User | null
}) {
  const state = message.state ?? 'sent'
  return (
    <div className={`row ${own ? 'own' : 'them'}`}>
      {!own && showSender ? (
        <Avatar size="sm" user={sender ?? { displayName: '?', accent: '#c9a26b' }} />
      ) : null}
      <div style={{ minWidth: 0 }}>
        {!own && showSender ? <div className="sender-name">{sender?.displayName ?? 'Unknown'}</div> : null}
        <div className="bubble" data-state={state === 'sent' ? undefined : state}>
          {message.body}
        </div>
        <div className="bubble-meta" style={{ textAlign: own ? 'right' : 'left' }}>
          {state === 'pending' ? 'sending…' : state === 'failed' ? 'not sent' : clock(message.createdAt)}
        </div>
      </div>
    </div>
  )
}

function SettingsSheet({
  runtime,
  conversation,
  meId,
  conversations,
  onClose,
  onStartDirectMessage,
  onSignedOut,
}: {
  runtime: Runtime
  conversation: ConversationSummary | null
  meId: string
  conversations: ConversationSummary[]
  onClose: () => void
  onStartDirectMessage: (userId: string) => Promise<void>
  onSignedOut: () => Promise<void> | void
}) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void runtime.settings.get().then(setSettings)
  }, [runtime])

  async function patch(next: Partial<AppSettings>): Promise<void> {
    setSettings(await runtime.settings.patch(next))
  }

  const people = useMemo(() => {
    const map = new Map<string, User>()
    for (const entry of conversations) {
      for (const member of entry.members) {
        if (member.id !== meId) map.set(member.id, member)
      }
    }
    return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [conversations, meId])

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet glass" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>

        {runtime.platform === 'desktop' ? (
          <>
            <div className="setting">
              <div>
                <div className="setting-label">Popup corner</div>
                <div className="setting-hint">Where the notification card appears.</div>
              </div>
              <select
                value={settings.corner}
                onChange={(event) => void patch({ corner: event.target.value as AppSettings['corner'] })}
              >
                <option value="top-right">Top right</option>
                <option value="top-left">Top left</option>
                <option value="bottom-right">Bottom right</option>
                <option value="bottom-left">Bottom left</option>
              </select>
            </div>

            <div className="setting">
              <div>
                <div className="setting-label">Popup duration</div>
                <div className="setting-hint">Hover to keep it a little longer.</div>
              </div>
              <div className="segmented">
                {[5000, 6000, 8000, 10000].map((value) => (
                  <button
                    key={value}
                    data-active={settings.popupDurationMs === value}
                    onClick={() => void patch({ popupDurationMs: value })}
                  >
                    {value / 1000}s
                  </button>
                ))}
              </div>
            </div>

            <div className="setting">
              <div>
                <div className="setting-label">Corner popups</div>
                <div className="setting-hint">Turn off to keep the tray icon quiet.</div>
              </div>
              <div className="segmented">
                <button data-active={settings.popupsEnabled} onClick={() => void patch({ popupsEnabled: true })}>
                  On
                </button>
                <button data-active={!settings.popupsEnabled} onClick={() => void patch({ popupsEnabled: false })}>
                  Off
                </button>
              </div>
            </div>

            <div className="setting">
              <div>
                <div className="setting-label">Start with Windows</div>
                <div className="setting-hint">Runs in the tray from login.</div>
              </div>
              <div className="segmented">
                <button data-active={settings.startAtLogin} onClick={() => void patch({ startAtLogin: true })}>
                  On
                </button>
                <button data-active={!settings.startAtLogin} onClick={() => void patch({ startAtLogin: false })}>
                  Off
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="setting-hint" style={{ margin: 0 }}>
            Messages arrive as notifications while this app is closed. Open the app to reply.
          </p>
        )}

        {conversation && conversation.kind === 'group' ? (
          <div>
            <div className="setting-label" style={{ marginBottom: 6 }}>
              In this group
            </div>
            <div className="member-list">
              {conversation.members
                .filter((member) => member.id !== meId)
                .map((member) => (
                  <button
                    key={member.id}
                    className="member"
                    onClick={() => void onStartDirectMessage(member.id)}
                  >
                    <Avatar size="sm" user={member} />
                    <span style={{ flex: 1 }}>{member.displayName}</span>
                    <span className="tiny muted">message</span>
                  </button>
                ))}
            </div>
          </div>
        ) : null}

        {people.length > 0 ? (
          <div>
            <div className="setting-label" style={{ marginBottom: 6 }}>
              People
            </div>
            <div className="member-list">
              {people.slice(0, 12).map((person) => (
                <button key={person.id} className="member" onClick={() => void onStartDirectMessage(person.id)}>
                  <Avatar size="sm" user={person} />
                  <span style={{ flex: 1 }}>{person.displayName}</span>
                  <span className="tiny muted">@{person.username}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <button
          className="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await runtime.api.logout().catch(() => undefined)
            } finally {
              await onSignedOut()
              setBusy(false)
            }
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
