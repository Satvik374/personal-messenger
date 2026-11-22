import type { FastifyInstance } from 'fastify'
import type { AuthSession } from '@pm/shared'
import { buildServer } from '../src/app.js'
import { createLocalDb, type DbClient } from '../src/db/client.js'
import { migrate } from '../src/db/migrate.js'
import { Repo } from '../src/db/repo.js'
import { loadEnv, type Env } from '../src/env.js'
import { disabledPush } from '../src/push/fcm.js'

export interface TestContext {
  app: FastifyInstance
  repo: Repo
  db: DbClient
  env: Env
}

export async function createTestContext(): Promise<TestContext> {
  const db = createLocalDb(':memory:')
  await migrate(db)
  const repo = new Repo(db)
  const env = loadEnv({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-not-for-production',
    BOOTSTRAP_INVITE: 'TEST-INVITE',
  } as unknown as NodeJS.ProcessEnv)

  await repo.ensureInvite('TEST-INVITE', null)
  const { app } = await buildServer({ env, repo, push: disabledPush, logger: false })
  return { app, repo, db, env }
}

export async function register(
  app: FastifyInstance,
  username: string,
  inviteCode = 'TEST-INVITE',
): Promise<AuthSession> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      inviteCode,
      username,
      password: 'password123',
      displayName: username,
    },
  })
  if (response.statusCode !== 200) {
    throw new Error(`register failed (${response.statusCode}): ${response.body}`)
  }
  return response.json<AuthSession>()
}

export function authHeaders(session: AuthSession): Record<string, string> {
  return { authorization: `Bearer ${session.accessToken}` }
}
