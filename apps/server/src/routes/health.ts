import type { FastifyInstance } from 'fastify'

const startedAt = Date.now()

/**
 * Deliberately does not touch the database: a Turso hiccup must not make the
 * keep-alive cron think the process is dead, and a wake-up ping should be cheap.
 */
export function registerHealthRoutes(app: FastifyInstance): void {
  const handler = async () => ({ ok: true as const, uptime: Math.floor((Date.now() - startedAt) / 1000) })
  app.get('/healthz', handler)
  app.get('/', handler)
}
