import { useEffect, useState } from 'react'
import type { AuthSession } from '@pm/shared'
import type { Runtime } from './lib/runtime'
import { Login } from './screens/Login'
import { Chat } from './screens/Chat'
import './theme.css'

export function App({ runtime }: { runtime: Runtime }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    let cancelled = false
    void runtime
      .loadSession()
      .then((stored) => {
        if (!cancelled) setSession(stored)
      })
      .finally(() => {
        if (!cancelled) setBooting(false)
      })
    return () => {
      cancelled = true
    }
  }, [runtime])

  if (booting) {
    return (
      <div className="app">
        <div className="aurora" />
        <div className="boot">
          <span className="brand-mark" aria-hidden />
          <span className="boot-copy">Opening your conversations…</span>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="app">
        <div className="aurora" />
        <Login
          runtime={runtime}
          onSignedIn={async (next) => {
            await runtime.saveSession(next)
            setSession(next)
            void runtime.registerPush?.()
          }}
        />
      </div>
    )
  }

  return (
    <div className="app">
      <div className="aurora" />
      <Chat
        runtime={runtime}
        session={session}
        onSignedOut={async () => {
          await runtime.saveSession(null)
          setSession(null)
        }}
      />
    </div>
  )
}
