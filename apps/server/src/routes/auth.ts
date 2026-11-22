import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AuthSession, User } from '@pm/shared'
import { hashPassword, verifyPassword } from '../auth/password.js'
import {
  createRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from '../auth/tokens.js'
import { requireUser } from '../auth/guard.js'
import type { Repo, UserRecord } from '../db/repo.js'
import type { Env } from '../env.js'
import { errors } from '../util/errors.js'
import { accentFor } from '../util/accent.js'
import { createRateLimiter } from '../util/rate-limit.js'

const registerSchema = z.object({
  inviteCode: z.string().trim().min(1).max(64),
  username: z
    .string()
    .trim()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/, 'Use letters, numbers and underscores only'),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(40),
})

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
  platform: z.enum(['desktop', 'android', 'web']).optional(),
})

const refreshSchema = z.object({ refreshToken: z.string().min(10) })

const DEFAULT_GROUP_TITLE = 'Friends'

function toUser(record: UserRecord): User {
  return {
    id: record.id,
    username: record.username,
    displayName: record.displayName,
    accent: record.accent,
    lastSeenAt: record.lastSeenAt,
  }
}

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: { repo: Repo; env: Env },
): void {
  const { repo, env } = deps
  const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 10 })
  const registerLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: 5 })

  async function issueSession(user: UserRecord, platform: string): Promise<AuthSession> {
    const refreshToken = createRefreshToken()
    const sessionId = randomUUID()
    await repo.createSession({
      id: sessionId,
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      platform,
      expiresAt: Date.now() + env.refreshTokenTtlSeconds * 1000,
    })
    return {
      accessToken: signAccessToken(
        { userId: user.id, sessionId },
        env.jwtSecret,
        env.accessTokenTtlSeconds,
      ),
      refreshToken,
      user: toUser(user),
    }
  }

  app.post('/auth/register', async (request) => {
    if (!registerLimiter.check(request.ip)) throw errors.tooMany('Too many attempts. Try later.')

    const parsed = registerSchema.safeParse(request.body)
    if (!parsed.success) {
      throw errors.badRequest('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input')
    }
    const { inviteCode, username, password, displayName } = parsed.data

    const invite = await repo.findInvite(inviteCode)
    if (!invite) throw errors.forbidden('INVITE_INVALID', 'That invite code does not exist')
    if (invite.usedBy) throw errors.forbidden('INVITE_USED', 'That invite code was already used')
    if (invite.expiresAt && invite.expiresAt < Date.now()) {
      throw errors.forbidden('INVITE_EXPIRED', 'That invite code has expired')
    }

    const existing = await repo.findUserByUsername(username)
    if (existing) throw errors.conflict('USERNAME_TAKEN', 'That username is taken')

    const userId = randomUUID()
    const user = await repo.createUser({
      id: userId,
      username,
      displayName,
      passwordHash: await hashPassword(password),
      accent: accentFor(username),
    })

    const claimed = await repo.consumeInvite(inviteCode, userId)
    if (!claimed) {
      await repo.deleteUser(userId).catch(() => undefined)
      throw errors.forbidden('INVITE_USED', 'That invite code was already used')
    }

    // Everyone who joins lands in the shared group, so the app is useful immediately.
    let groupId = await repo.findGroupByTitle(DEFAULT_GROUP_TITLE)
    if (!groupId) {
      groupId = randomUUID()
      await repo.createConversation({
        id: groupId,
        kind: 'group',
        title: DEFAULT_GROUP_TITLE,
        dmKey: null,
        createdBy: userId,
      })
    }
    await repo.addMember(groupId, userId)

    return issueSession(user, 'desktop')
  })

  app.post('/auth/login', async (request) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) throw errors.badRequest('VALIDATION', 'Invalid input')
    if (!loginLimiter.check(request.ip)) throw errors.tooMany('Too many attempts. Try later.')

    const user = await repo.findUserByUsername(parsed.data.username)
    const valid = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false
    if (!user || !valid) {
      throw errors.unauthorized('INVALID_CREDENTIALS', 'Wrong username or password')
    }
    return issueSession(user, parsed.data.platform ?? 'desktop')
  })

  app.post('/auth/refresh', async (request) => {
    const parsed = refreshSchema.safeParse(request.body)
    if (!parsed.success) throw errors.badRequest('VALIDATION', 'Invalid input')

    const session = await repo.findSessionByHash(hashRefreshToken(parsed.data.refreshToken))
    if (!session) throw errors.unauthorized('REFRESH_INVALID')

    if (session.revokedAt) {
      // A revoked token being replayed means it leaked: drop every session for that user.
      await repo.revokeAllSessions(session.userId)
      throw errors.unauthorized('REFRESH_REVOKED', 'Session ended. Please sign in again.')
    }
    if (session.expiresAt < Date.now()) throw errors.unauthorized('REFRESH_EXPIRED')

    const user = await repo.findUserById(session.userId)
    if (!user) throw errors.unauthorized('REFRESH_INVALID')

    // Retire the old row before returning the new pair, so replaying it is detected.
    await repo.revokeSession(session.id)
    const next = await issueSession(user, session.platform)
    return { accessToken: next.accessToken, refreshToken: next.refreshToken }
  })

  app.post('/auth/logout', async (request) => {
    const parsed = refreshSchema.safeParse(request.body)
    if (parsed.success) {
      const session = await repo.findSessionByHash(hashRefreshToken(parsed.data.refreshToken))
      if (session) await repo.revokeSession(session.id)
    }
    return { ok: true as const }
  })

  app.get('/me', async (request) => {
    const user = await requireUser(request, repo, env.jwtSecret)
    return { user: toUser(user) }
  })
}
