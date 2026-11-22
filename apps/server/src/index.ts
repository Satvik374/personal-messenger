import { buildServer } from './app.js'
import { createDb } from './db/client.js'
import { migrate } from './db/migrate.js'
import { Repo } from './db/repo.js'
import { loadEnv } from './env.js'
import { createPushService } from './push/fcm.js'

async function main(): Promise<void> {
  const env = loadEnv()
  const db = createDb(env.tursoUrl, env.tursoToken)
  const schemaVersion = await migrate(db)
  const repo = new Repo(db)

  // Seed the invitations friends will use. Each admits one person, and existing
  // (even consumed) invites are left untouched.
  for (const code of env.bootstrapInvites) {
    await repo.ensureInvite(code, null)
  }

  const push = createPushService(env.fcmServiceAccount)
  const { app } = await buildServer({ env, repo, push, logger: true })

  await app.listen({ port: env.port, host: env.host })
  app.log.info(
    {
      schemaVersion,
      pushEnabled: push.enabled,
      database: env.tursoUrl.startsWith('libsql') ? 'turso' : 'local-sqlite',
      ...(env.nodeEnv === 'production' ? {} : { invite: env.bootstrapInvite }),
    },
    'messenger server ready',
  )

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down')
    try {
      await app.close()
    } finally {
      db.close()
      process.exit(0)
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((error: unknown) => {
  console.error('[server] failed to start:', error)
  process.exit(1)
})
