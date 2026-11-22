import type { User } from '@pm/shared'

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase()
  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase()
}

export function Avatar({
  user,
  online,
  size = 'md',
}: {
  user: Pick<User, 'displayName' | 'accent'>
  online?: boolean
  size?: 'sm' | 'md'
}) {
  return (
    <span
      className={`avatar${size === 'sm' ? ' sm' : ''}`}
      style={{
        background: `linear-gradient(140deg, ${user.accent}, color-mix(in srgb, ${user.accent} 45%, #ffffff))`,
      }}
      aria-hidden
    >
      {initials(user.displayName)}
      {online ? <span className="presence" /> : null}
    </span>
  )
}
