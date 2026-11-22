import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import type { WebSocketServer } from 'ws'
import type { Repo } from './db/repo.js'
import type { Env } from './env.js'
import type { PushService } from './push/fcm.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerChatRoutes } from './routes/chat.js'
import { registerHealthRoutes } from './routes/health.js'
import { ApiError } from './util/errors.js'
import { Hub } from './ws/hub.js'
import { attachSocketServer } from './ws/socket.js'

export interface BuildOptions {
  env: Env
  repo: Repo
  push: PushService
  logger?: boolean
}

export interface BuiltServer {
  app: FastifyInstance
  hub: Hub
  wss: WebSocketServer
}

export async function buildServer(options: BuildOptions): Promise<BuiltServer> {
  const { env, repo, push } = options
  const hub = new Hub()

  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: process.env.LOG_LEVEL ?? 'info',
            redact: {
              paths: ['req.headers.authorization'],
              censor: '[redacted]',
            },
          },
    trustProxy: true,
    bodyLimit: 64 * 1024,
  })

  // Bearer tokens only, no cookies: a wildcard origin cannot leak credentials here.
  await app.register(cors, {
    origin: true,
    credentials: false,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization'],
  })

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } })
      return
    }
    const candidate = error as { statusCode?: number; message?: string }
    if (candidate.statusCode && candidate.statusCode < 500) {
      reply
        .status(candidate.statusCode)
        .send({ error: { code: 'BAD_REQUEST', message: candidate.message ?? 'Bad request' } })
      return
    }
    request.log.error(error)
    reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong' } })
  })

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: `No route for ${request.url}` } })
  })

  registerHealthRoutes(app)
  registerAuthRoutes(app, { repo, env })
  registerChatRoutes(app, { repo, env })

  const wss = attachSocketServer({ server: app.server, repo, hub, push, jwtSecret: env.jwtSecret })
  app.addHook('onClose', async () => {
    await new Promise<void>((resolve) => wss.close(() => resolve()))
  })

  return { app, hub, wss }
}
