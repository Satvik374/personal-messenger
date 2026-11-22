import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { AuthSession, ClientEvent, ServerEvent } from '@pm/shared'
import { authHeaders, createTestContext, register, type TestContext } from './helpers.js'

interface TestClient {
  ws: WebSocket
  closed: Promise<number>
  waitFor<T extends ServerEvent['t']>(
    type: T,
    predicate?: (event: Extract<ServerEvent, { t: T }>) => boolean,
  ): Promise<Extract<ServerEvent, { t: T }>>
  send(event: ClientEvent): void
  close(): void
}

let ctx: TestContext
let port: number
const open: TestClient[] = []

beforeEach(async () => {
  ctx = await createTestContext()
  await ctx.app.listen({ port: 0, host: '127.0.0.1' })
  const address = ctx.app.server.address()
  if (!address || typeof address === 'string') throw new Error('server has no port')
  port = address.port
})

afterEach(async () => {
  for (const client of open.splice(0)) client.close()
  await ctx.app.close()
  ctx.db.close()
})

function connect(token: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/socket?token=${encodeURIComponent(token)}`)
    const events: ServerEvent[] = []
    const closeState = { code: -1 }

    const closed = new Promise<number>((res) => {
      ws.on('close', (code) => {
        closeState.code = code
        res(code)
      })
    })

    const client: TestClient = {
      ws,
      closed,
      async waitFor(type, predicate) {
        const deadline = Date.now() + 3000
        while (Date.now() < deadline) {
          const found = events.find(
            (event) =>
              event.t === type &&
              (!predicate || predicate(event as Extract<ServerEvent, { t: typeof type }>)),
          )
          if (found) return found as Extract<ServerEvent, { t: typeof type }>
          if (closeState.code !== -1) {
            throw new Error(`socket closed with ${closeState.code} while waiting for ${type}`)
          }
          await new Promise((r) => setTimeout(r, 10))
        }
        throw new Error(`timed out waiting for ${type}`)
      },
      send(event) {
        ws.send(JSON.stringify(event))
      },
      close() {
        if (ws.readyState <= WebSocket.OPEN) ws.close()
      },
    }

    ws.on('message', (raw) => {
      events.push(JSON.parse(raw.toString()) as ServerEvent)
    })
    ws.on('open', () => {
      open.push(client)
      resolve(client)
    })
    ws.on('error', reject)
  })
}

async function seedInvites(...codes: string[]): Promise<void> {
  for (const code of codes) await ctx.repo.ensureInvite(code, null)
}

async function setUpThreeUsers(): Promise<{
  alice: AuthSession
  bob: AuthSession
  eve: AuthSession
  groupId: string
}> {
  await seedInvites('INV-A', 'INV-B', 'INV-E')
  const alice = await register(ctx.app, 'alice', 'INV-A')
  const bob = await register(ctx.app, 'bob', 'INV-B')
  const eve = await register(ctx.app, 'eve', 'INV-E')
  const conversations = await ctx.repo.listConversations(alice.user.id)
  return { alice, bob, eve, groupId: conversations[0]!.id }
}

describe('realtime', () => {
  it('delivers a sent message to the other member with a server id', async () => {
    const { alice, bob, groupId } = await setUpThreeUsers()
    const aliceSocket = await connect(alice.accessToken)
    const bobSocket = await connect(bob.accessToken)
    await aliceSocket.waitFor('ready')
    await bobSocket.waitFor('ready')

    aliceSocket.send({
      t: 'send',
      clientId: 'client-abc',
      conversationId: groupId,
      body: 'hello friends',
    })

    const ack = await aliceSocket.waitFor('ack', (event) => event.clientId === 'client-abc')
    expect(ack.message.body).toBe('hello friends')
    expect(ack.message.id).toBeGreaterThan(0)

    const received = await bobSocket.waitFor('msg', (event) => event.message.id === ack.message.id)
    expect(received.message.senderId).toBe(alice.user.id)
    expect(received.message.clientId).toBe('client-abc')
  })

  it('assigns increasing ids so clients can use them as cursors', async () => {
    const { alice, groupId } = await setUpThreeUsers()
    const socket = await connect(alice.accessToken)
    await socket.waitFor('ready')

    socket.send({ t: 'send', clientId: 'c1', conversationId: groupId, body: 'first' })
    const first = await socket.waitFor('ack', (event) => event.clientId === 'c1')
    socket.send({ t: 'send', clientId: 'c2', conversationId: groupId, body: 'second' })
    const second = await socket.waitFor('ack', (event) => event.clientId === 'c2')

    expect(second.message.id).toBeGreaterThan(first.message.id)
  })

  it('is idempotent for a retried client id', async () => {
    const { alice, groupId } = await setUpThreeUsers()
    const socket = await connect(alice.accessToken)
    await socket.waitFor('ready')

    socket.send({ t: 'send', clientId: 'same', conversationId: groupId, body: 'once' })
    const first = await socket.waitFor('ack', (event) => event.clientId === 'same')
    socket.send({ t: 'send', clientId: 'same', conversationId: groupId, body: 'once' })
    const second = await socket.waitFor('ack', (event) => event.clientId === 'same')

    expect(second.message.id).toBe(first.message.id)
  })

  it('rejects a send into a conversation the user does not belong to', async () => {
    const { alice, bob, eve } = await setUpThreeUsers()

    const dm = (
      await ctx.app.inject({
        method: 'POST',
        url: '/conversations/dm',
        headers: authHeaders(alice),
        payload: { userId: bob.user.id },
      })
    ).json<{ conversation: { id: string } }>().conversation

    const eveSocket = await connect(eve.accessToken)
    await eveSocket.waitFor('ready')

    eveSocket.send({ t: 'send', clientId: 'sneaky', conversationId: dm.id, body: 'hi' })
    const error = await eveSocket.waitFor('error', (event) => event.clientId === 'sneaky')
    expect(error.code).toBe('NOT_A_MEMBER')
  })

  it('rejects empty messages without touching the database', async () => {
    const { alice, groupId } = await setUpThreeUsers()
    const socket = await connect(alice.accessToken)
    await socket.waitFor('ready')

    socket.send({ t: 'send', clientId: 'empty', conversationId: groupId, body: '   ' })
    const error = await socket.waitFor('error', (event) => event.clientId === 'empty')
    expect(error.code).toBe('VALIDATION')
  })

  it('closes the socket with 4401 when the token is bad', async () => {
    const client = await connect('not-a-real-token')
    await expect(client.closed).resolves.toBe(4401)
  })

  it('lets a client catch up after being offline without gaps', async () => {
    const { alice, bob, groupId } = await setUpThreeUsers()

    const aliceSocket = await connect(alice.accessToken)
    await aliceSocket.waitFor('ready')
    aliceSocket.send({ t: 'send', clientId: 'm1', conversationId: groupId, body: 'while away 1' })
    await aliceSocket.waitFor('ack', (event) => event.clientId === 'm1')
    aliceSocket.send({ t: 'send', clientId: 'm2', conversationId: groupId, body: 'while away 2' })
    await aliceSocket.waitFor('ack', (event) => event.clientId === 'm2')

    // Bob was never connected during those sends; /sync is his catch-up path.
    const sync = await ctx.app.inject({
      method: 'GET',
      url: '/sync?since=0',
      headers: authHeaders(bob),
    })
    const body = sync.json<{ messages: { body: string }[]; cursor: number }>()
    expect(body.messages.map((message) => message.body)).toEqual([
      'while away 1',
      'while away 2',
    ])
    expect(body.cursor).toBeGreaterThan(0)
  })
})
