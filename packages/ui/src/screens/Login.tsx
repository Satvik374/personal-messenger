import { useState } from 'react'
import type { AuthSession } from '@pm/shared'
import { ApiError } from '@pm/shared'
import type { Runtime } from '../lib/runtime'

type Mode = 'signin' | 'join'

export function Login({
  runtime,
  onSignedIn,
}: {
  runtime: Runtime
  onSignedIn: (session: AuthSession) => Promise<void> | void
}) {
  const [mode, setMode] = useState<Mode>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const session =
        mode === 'signin'
          ? await runtime.api.login(username.trim(), password)
          : await runtime.api.register({
              inviteCode: inviteCode.trim(),
              username: username.trim(),
              password,
              displayName: displayName.trim() || username.trim(),
            })
      await onSignedIn(session)
    } catch (cause) {
      const message =
        cause instanceof ApiError
          ? FRIENDLY[cause.code] ?? cause.message
          : 'Could not reach the server. Check your connection and try again.'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-brand">
        <div className="auth-lockup">
          <span className="brand-mark" aria-hidden />
          <span className="auth-wordmark">Personal Messenger</span>
        </div>

        <div>
          <h1 className="auth-statement">A quiet room for the people you text.</h1>
          <p className="auth-note">
            No feed, no algorithm, no strangers. Just your friends, on the laptop you leave open
            and the phone in your pocket.
          </p>
        </div>
      </div>

      <form className="auth-card glass" onSubmit={submit}>
        <div>
          <h2 className="auth-form-title">
            {mode === 'signin' ? 'Welcome back' : 'Join the conversation'}
          </h2>
          <p className="auth-form-sub">
            {mode === 'signin'
              ? 'Pick up where you left off.'
              : 'You need an invite from someone already here.'}
          </p>
        </div>

        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            data-active={mode === 'signin'}
            onClick={() => setMode('signin')}
          >
            Sign in
          </button>
          <button type="button" role="tab" data-active={mode === 'join'} onClick={() => setMode('join')}>
            Join with invite
          </button>
        </div>

        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="yourname"
            required
          />
        </div>

        {mode === 'join' ? (
          <>
            <div className="field">
              <label htmlFor="displayName">Display name</label>
              <input
                id="displayName"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="How friends see you"
                maxLength={40}
              />
            </div>
            <div className="field">
              <label htmlFor="invite">Invite code</label>
              <input
                id="invite"
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value)}
                placeholder="FRIENDS2026"
                autoCapitalize="characters"
                spellCheck={false}
                required
              />
            </div>
          </>
        ) : null}

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'join' ? 'new-password' : 'current-password'}
            placeholder={mode === 'join' ? 'At least 8 characters' : 'Your password'}
            minLength={mode === 'join' ? 8 : undefined}
            required
          />
        </div>

        {error ? <p className="error">{error}</p> : null}

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create my account'}
        </button>

        <p className="auth-footnote">
          {mode === 'signin'
            ? 'Ask the owner for an invite if you need an account.'
            : 'Invite codes work once, so yours is yours alone.'}
        </p>
      </form>
    </div>
  )
}

const FRIENDLY: Record<string, string> = {
  INVALID_CREDENTIALS: 'Wrong username or password.',
  INVITE_INVALID: 'That invite code does not exist.',
  INVITE_USED: 'That invite code has already been used.',
  INVITE_EXPIRED: 'That invite code has expired.',
  USERNAME_TAKEN: 'Someone already has that username.',
  RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
  VALIDATION: 'Check the details and try again.',
}
