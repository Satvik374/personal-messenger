import { createSign } from 'node:crypto'

interface ServiceAccount {
  client_email: string
  private_key: string
  project_id: string
}

export interface MessagePush {
  title: string
  body: string
  conversationId: string
  messageId: number
}

export interface PushService {
  readonly enabled: boolean
  sendMessage(tokens: string[], push: MessagePush): Promise<void>
}

export const disabledPush: PushService = {
  enabled: false,
  async sendMessage() {
    /* push is optional; the desktop app never needs it */
  },
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

function parseServiceAccount(raw: string): ServiceAccount | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const json = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8')
  try {
    const parsed = JSON.parse(json) as Partial<ServiceAccount>
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) return null
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
      project_id: parsed.project_id,
    }
  } catch {
    return null
  }
}

/**
 * Sends Android notifications through FCM HTTP v1. Implemented with node:crypto
 * only, so the server keeps zero native dependencies and a small image.
 */
export function createPushService(rawServiceAccount: string): PushService {
  const account = parseServiceAccount(rawServiceAccount)
  if (!account) {
    return {
      enabled: false,
      async sendMessage() {
        /* not configured */
      },
    }
  }

  let cachedToken: { value: string; expiresAt: number } | null = null

  async function accessToken(): Promise<string | null> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value

    const now = Math.floor(Date.now() / 1000)
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claim = base64url(
      JSON.stringify({
        iss: account!.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    )
    const signingInput = `${header}.${claim}`

    let signature: string
    try {
      const signer = createSign('RSA-SHA256')
      signer.update(signingInput)
      signer.end()
      signature = signer.sign(account!.private_key).toString('base64url')
    } catch {
      return null
    }

    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: `${signingInput}.${signature}`,
        }),
      })
      if (!response.ok) return null
      const payload = (await response.json()) as { access_token?: string; expires_in?: number }
      if (!payload.access_token) return null
      const ttl = (payload.expires_in ?? 3600) * 1000
      cachedToken = { value: payload.access_token, expiresAt: Date.now() + ttl }
      return cachedToken.value
    } catch {
      return null
    }
  }

  return {
    enabled: true,
    async sendMessage(tokens, push) {
      if (tokens.length === 0) return
      const bearer = await accessToken()
      if (!bearer) return

      const endpoint = `https://fcm.googleapis.com/v1/projects/${account!.project_id}/messages:send`
      const body = (token: string) =>
        JSON.stringify({
          message: {
            token,
            notification: { title: push.title, body: push.body },
            data: {
              conversationId: push.conversationId,
              messageId: String(push.messageId),
            },
            android: {
              priority: 'HIGH',
              notification: { channel_id: 'messages', default_vibrate_timings: true },
            },
          },
        })

      await Promise.allSettled(
        tokens.map((token) =>
          fetch(endpoint, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${bearer}`,
              'content-type': 'application/json',
            },
            body: body(token),
          }).then(async (response) => {
            if (!response.ok) {
              const text = await response.text().catch(() => '')
              console.warn(`[push] FCM rejected a token (${response.status}): ${text.slice(0, 200)}`)
            }
          }),
        ),
      )
    },
  }
}
