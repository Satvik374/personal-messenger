import { randomBytes } from 'node:crypto'

export interface Env {
  port: number
  host: string
  nodeEnv: string
  tursoUrl: string
  tursoToken: string
  jwtSecret: string
  fcmServiceAccount: string
  bootstrapInvite: string
  /** BOOTSTRAP_INVITE plus any extra codes from BOOTSTRAP_INVITES, all seeded at startup. */
  bootstrapInvites: string[]
  accessTokenTtlSeconds: number
  refreshTokenTtlSeconds: number
}

function missing(name: string): Error {
  return new Error(
    `Missing required environment variable ${name}. See apps/server/.env.example for the full list.`,
  )
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const nodeEnv = source.NODE_ENV ?? 'development'
  const isProduction = nodeEnv === 'production'

  let jwtSecret = source.JWT_SECRET ?? ''
  if (!jwtSecret) {
    if (isProduction) throw missing('JWT_SECRET')
    // Development only: a fixed secret so restarts do not invalidate local sessions.
    jwtSecret = 'development-only-insecure-secret-change-me'
  }

  const tursoUrl = source.TURSO_DATABASE_URL ?? ''
  const tursoToken = source.TURSO_AUTH_TOKEN ?? ''
  if (isProduction && tursoUrl && !tursoToken) throw missing('TURSO_AUTH_TOKEN')

  // Each invite admits one person, so the primary code gets a numbered companion
  // by default; BOOTSTRAP_INVITES is a comma-separated list to add more.
  const bootstrapInvite = source.BOOTSTRAP_INVITE ?? 'FRIENDS2026'
  const extraInvites = (source.BOOTSTRAP_INVITES ?? `${bootstrapInvite}-2`).split(',')
  const bootstrapInvites = [...new Set(
    [bootstrapInvite, ...extraInvites].map((code) => code.trim()).filter(Boolean),
  )]

  return {
    port: Number(source.PORT ?? 8787),
    host: source.HOST ?? '0.0.0.0',
    nodeEnv,
    tursoUrl,
    tursoToken,
    jwtSecret,
    fcmServiceAccount: source.FCM_SERVICE_ACCOUNT_JSON ?? '',
    bootstrapInvite,
    bootstrapInvites,
    accessTokenTtlSeconds: 15 * 60,
    refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
  }
}

/** Random hex secret, used by the setup script and documented in the README. */
export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString('hex')
}
