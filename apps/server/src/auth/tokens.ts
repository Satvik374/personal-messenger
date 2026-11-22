import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export interface AccessClaims {
  sub: string
  sid: string
  iat: number
  exp: number
}

function sign(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url')
}

export function signAccessToken(
  input: { userId: string; sessionId: string },
  secret: string,
  ttlSeconds: number,
): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      sub: input.userId,
      sid: input.sessionId,
      iat: now,
      exp: now + ttlSeconds,
    }),
  ).toString('base64url')
  const body = `${header}.${payload}`
  return `${body}.${sign(secret, body)}`
}

export function verifyAccessToken(token: string, secret: string): AccessClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, signature] = parts as [string, string, string]

  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest()
  let provided: Buffer
  try {
    provided = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null

  let claims: AccessClaims
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AccessClaims
  } catch {
    return null
  }
  if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string') return null
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return null
  return claims
}

export function createRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
