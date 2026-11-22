import type { FastifyRequest } from 'fastify'
import { errors } from '../util/errors.js'
import type { Repo, UserRecord } from '../db/repo.js'
import { verifyAccessToken } from './tokens.js'

export async function requireUser(
  request: FastifyRequest,
  repo: Repo,
  jwtSecret: string,
): Promise<UserRecord> {
  const header = request.headers.authorization
  if (!header || !header.startsWith('Bearer ')) throw errors.unauthorized()
  const claims = verifyAccessToken(header.slice('Bearer '.length), jwtSecret)
  if (!claims) throw errors.unauthorized('TOKEN_INVALID')
  const user = await repo.findUserById(claims.sub)
  if (!user) throw errors.unauthorized('TOKEN_INVALID')
  return user
}
