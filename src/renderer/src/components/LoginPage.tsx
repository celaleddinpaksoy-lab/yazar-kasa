import { useState } from 'react'
import type { FormEvent } from 'react'
import type { User } from '@shared/types'

interface Props {
  onLogin: (user: User) => void
}

export default function LoginPage({ onLogin }: Props): React.JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await window.api.authLogin(username, password)
      if (result.ok && result.user) {
        onLogin(result.user)
      } else {
        setError(result.error ?? 'Giriş başarısız')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Yazar Kasa</h1>
        <p className="subtitle">Stok · Borç · Taksit · Defter</p>

        <label>
          Kullanıcı adı
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
          />
        </label>

        <label>
          Şifre
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={busy || !username || !password}>
          {busy ? 'Giriş yapılıyor…' : 'Giriş Yap'}
        </button>
      </form>
    </div>
  )
}