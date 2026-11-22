import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AuthSession, ConversationSummary } from '@pm/shared'
import { authHeaders, createTestContext, register, type TestContext } from './helpers.js'

let ctx: TestContext

beforeEach(async () => {
  ctx = await createTestContext()
})

afterEach(async () => {
  await ctx.app.close()
  ctx.db.close()
})

/** Registers users with one invite each, since invites are single-use by design. */
async function makeUsers(...names: string[]): Promise<AuthSession[]> {
  const sessions: AuthSession[] = []
  for (const [index, name] of names.entries()) {
    const code = index === 0 ? 'TEST-INVITE' : `TEST-INVITE-${index}`
    if (index > 0) await ctx.repo.ensureInvite(code, null)
    sessions.push(await register(ctx.app, name, code))
  }
  return sessions
}

describe('health', () => {
  it('reports ok without touching the database', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/healthz' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ok: true })
  })
})

describe('auth', () => {
  it('registers with a valid invite and returns a session', async () => {
    const session = await register(ctx.app, 'alice')
    expect(session.accessToken).toBeTruthy()
    expect(session.refreshToken).toBeTruthy()
    expect(session.user.username).toBe('alice')
    expect(session.user.accent).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('seeds every new member into the shared group', async () => {
    const [alice] = await makeUsers('alice')
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/conversations',
      headers: authHeaders(alice!),
    })
    const conversations = response.json<{ conversations: ConversationSummary[] }>().conversations
    expect(conversations).toHaveLength(1)
    expect(conversations[0]?.kind).toBe('group')
    expect(conversations[0]?.title).toBe('Friends')
  })

  it('burns the invite code after first use', async () => {
    await register(ctx.app, 'alice')
    const second = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        inviteCode: 'TEST-INVITE',
        username: 'bob',
        password: 'password123',
        displayName: 'bob',
      },
    })
    expect(second.statusCode).toBe(403)
    expect(second.json().error.code).toBe('INVITE_USED')
  })

  it('rejects a wrong password', async () => {
    await register(ctx.app, 'alice')
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'alice', password: 'nope' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS')
  })

  it('logs in case-insensitively', async () => {
    await register(ctx.app, 'alice')
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ALICE', password: 'password123' },
    })
    expect(response.statusCode).toBe(200)
  })

  it('rotates refresh tokens and revokes the session when one is replayed', async () => {
    const session = await register(ctx.app, 'alice')

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    })
    expect(first.statusCode).toBe(200)
    const rotated = first.json<AuthSession>()
    expect(rotated.refreshToken).not.toBe(session.refreshToken)

    // Replaying the retired token must fail and invalidate the live one too.
    const replay = await ctx.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    })
    expect(replay.statusCode).toBe(401)

    const afterReplay = await ctx.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: rotated.refreshToken },
    })
    expect(afterReplay.statusCode).toBe(401)
  })

  it('requires a token for private routes', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/conversations' })
    expect(response.statusCode).toBe(401)
  })
})

describe('conversations and messages', () => {
  it('opens a direct message once per pair and shares history both ways', async () => {
    const [alice, bob] = await makeUsers('alice', 'bob')

    const opened = await ctx.app.inject({
      method: 'POST',
      url: '/conversations/dm',
      headers: authHeaders(alice!),
      payload: { userId: bob!.user.id },
    })
    expect(opened.statusCode).toBe(200)
    const dm = opened.json<{ conversation: ConversationSummary }>().conversation
    expect(dm.kind).toBe('dm')

    const again = await ctx.app.inject({
      method: 'POST',
      url: '/conversations/dm',
      headers: authHeaders(alice!),
      payload: { userId: bob!.user.id },
    })
    expect(again.json<{ conversation: ConversationSummary }>().conversation.id).toBe(dm.id)

    await ctx.repo.insertMessage({
      conversationId: dm.id,
      senderId: alice!.user.id,
      body: 'hello bob',
      clientId: 'client-1',
    })

    const page = await ctx.app.inject({
      method: 'GET',
      url: `/messages?conversationId=${dm.id}`,
      headers: authHeaders(bob!),
    })
    expect(page.statusCode).toBe(200)
    expect(page.json<{ messages: { body: string }[] }>().messages[0]?.body).toBe('hello bob')
  })

  it('refuses messages in a conversation the caller is not part of', async () => {
    const [alice, bob, eve] = await makeUsers('alice', 'bob', 'eve')

    const opened = await ctx.app.inject({
      method: 'POST',
      url: '/conversations/dm',
      headers: authHeaders(alice!),
      payload: { userId: bob!.user.id },
    })
    const conversationId = opened.json<{ conversation: ConversationSummary }>().conversation.id

    const forbidden = await ctx.app.inject({
      method: 'GET',
      url: `/messages?conversationId=${conversationId}`,
      headers: authHeaders(eve!),
    })
    expect(forbidden.statusCode).toBe(403)
    expect(forbidden.json().error.code).toBe('NOT_A_MEMBER')
  })

  it('syncs only messages after the cursor, scoped to membership', async () => {
    const [alice, bob] = await makeUsers('alice', 'bob')

    const aliceConversations = await ctx.repo.listConversations(alice!.user.id)
    const groupId = aliceConversations[0]!.id

    const first = await ctx.repo.insertMessage({
      conversationId: groupId,
      senderId: alice!.user.id,
      body: 'one',
      clientId: 'c1',
    })
    const second = await ctx.repo.insertMessage({
      conversationId: groupId,
      senderId: alice!.user.id,
      body: 'two',
      clientId: 'c2',
    })

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/sync?since=${first.message.id}`,
      headers: authHeaders(bob!),
    })
    const body = response.json<{ messages: { id: number }[]; cursor: number }>()
    expect(body.messages.map((message) => message.id)).toEqual([second.message.id])
    expect(body.cursor).toBe(second.message.id)
  })

  it('is idempotent when the same client id is retried', async () => {
    const [alice] = await makeUsers('alice')
    const conversations = await ctx.repo.listConversations(alice!.user.id)
    const groupId = conversations[0]!.id

    const first = await ctx.repo.insertMessage({
      conversationId: groupId,
      senderId: alice!.user.id,
      body: 'retry me',
      clientId: 'retry-1',
    })
    const second = await ctx.repo.insertMessage({
      conversationId: groupId,
      senderId: alice!.user.id,
      body: 'retry me',
      clientId: 'retry-1',
    })

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.message.id).toBe(first.message.id)
  })
})
