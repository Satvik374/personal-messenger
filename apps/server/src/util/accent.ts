import { createHash } from 'node:crypto'

const PALETTE = [
  '#818cf8',
  '#c084fc',
  '#22d3ee',
  '#34d399',
  '#fbbf24',
  '#fb7185',
  '#f472b6',
  '#60a5fa',
] as const

/** Stable avatar tint derived from the username, so it never changes between logins. */
export function accentFor(username: string): string {
  const digest = createHash('sha256').update(username.toLowerCase()).digest()
  const index = (digest[0] ?? 0) % PALETTE.length
  return PALETTE[index] ?? PALETTE[0]
}
