import React, { useEffect, useState } from 'react'
import type { User } from '@shared/types'
import LoginPage from './components/LoginPage'
import AppShell from './components/AppShell'

export default function App(): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    window.api
      .authMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setChecking(false))
  }, [])

  if (checking) {
    return <div className="app"><p className="muted">Yükleniyor…</p></div>
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />
  }

  return <AppShell user={user} onLogout={() => setUser(null)} />
}