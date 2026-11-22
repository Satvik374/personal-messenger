import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth/guard.js'
import type { Repo } from '../db/repo.js'
import type { Env } from '../env.js'
import { errors } from '../util/errors.js'

const SYNC_LIMIT = 500

const dmSchema = z.object({ userId: z.string().min(1) })
const titleSchema = z.object({
  conversationId: z.string().min(1),
  title: z.string().trim().min(1).max(40),
})
const deviceSchema = z.object({
  platform: z.enum(['desktop', 'android']),
  fcmToken: z.string().min(10).max(4096).nullable().optional(),
})

function dmKeyFor(a: string, b: string): string {
  return [a, b].sort().join(':')
}

export function registerChatRoutes(app: FastifyInstance, deps: { repo: Repo; env: Env }): void {
  const { repo, env } = deps

  app.get('/conversations', async (request) => {
    const user = await requireUser(request, repo, env.jwtSecret)
    return { conversations: await repo.listConversations(user.id) }
  })

  app.post('/conversations/dm', async (request) => {
    const user = await requireUser(request, repo, env.jwtSecret)
    const parsed = dmSchema.safeParse(request.body)
    if (!parsed.success) throw errors.badRequest('VALIDATION', 'userId is required')
    if (parsed.data.userId === user.id) throw errors.badRequest('SELF_DM', 'Cannot message yourself')

    const other = await repo.findUserById(parsed.data.userId)
    if (!other) throw errors.notFound('USER_NOT_FOUND')

    const key = dmKeyFor(user.id, other.id)
    let conversationId = await repo.findConversationByDmKey(key)
    if (!conversationId) {
      conversationId = randomUUID()
      await repo.createConversation({
        id: conversationId,
        kind: 'dm',
        title: null,
        dmKey: key,
        createdBy: user.id,
      })
      await repo.addMember(conversationId, user.id)
      await repo.addMember(conversationId, other.id)
    }

    const conversation = await repo.getConversation(conversationId, user.id)
    if (!conversation) throw errors.internal('Could not open conversation')
    return { conversation }
  })

  app.post('/conversations/title', async (request) => {
    const user = await requireUser(request, repo, env.jwtSecret)
    const parsed = titleSchema.safeParse(request.body)
    if (!parsed.success) throw errors.badRequest('VALIDATION', 'Invalid title')
    if (!(await repo.isMember(parsed.data.conversationId, user.id))) {
      throw errors.forbidden('NOT_A_MEMBER')
    }
    await repo.setConversationTitle(parsed.data.conversationId, parsed.data.title)
    return { ok: true as const }
  })

  app.get('/messages', async (request) => {
    const user = await requireUser(request, repo, env.jwtSecret)
    const query = request.query as Record<string, string | undefined>
    const conversationId = query.conversationId
    if (!conversationId) throw errors.badRequest('VALIDATION', 'conversationId is required')
    if (!(await repo.isMember(conversationId, user.id))) throw errors.forbidden('NOT_A_MEMBER')

    const before = query.before ? Number(query.before) : undefined
    const limit = query.limit ? Number(query.limit) : 50
    return repo.getMessages(conversationId, {
      before: Number.isFinite(before) ? before : undefined,
      limit: Number.isFinite(limit) ? limit : 50,
    })
  })

  app.get('/sync', async (request) => {
    const user = await requireUser(request, repo, env.jwtSecret)
    const query = request.query as Record<string, string | undefined>
    const since = Number(query.since ?? '0')
    if (!Number.isFinite(since) || since < 0) throw errors.badRequest('VALIDATION', 'Invalid cursor')

    const page = await repo.syncMessages(user.id, since, query.conversationId ?? null, SYNC_LIMIT)
    const cursor = page.messages.length > 0 ? (page.messages.at(-1)?.id ?? since) : since
    return { messages: page.messages, hasMore: page.hasMore, cursor }
  })

  app.post('/devices', async (request) => {
    const user = await requireUser(request, repo, env.jwtSecret)
    const parsed = deviceSchema.safeParse(request.body)
    if (!parsed.success) throw errors.badRequest('VALIDATION', 'Invalid device')
    await repo.upsertDevice({
      id: randomUUID(),
      userId: user.id,
      platform: parsed.data.platform,
      fcmToken: parsed.data.fcmToken ?? null,
    })
    return { ok: true as const }
  })

  app.delete('/devices/:id', async (request) => {
    const user = await requireUser(request, repo, env.jwtSecret)
    const params = request.params as { id?: string }
    if (params.id) await repo.deleteDevice(user.id, params.id)
    return { ok: true as const }
  })

}
