import React, { useCallback, useEffect, useState } from 'react'
import type { AppInfo, BackupInfo, User } from '@shared/types'
import { useDataVersion } from '../context/DataContext'
import { formatDateTime } from '../utils/format'

const KIND_LABEL: Record<BackupInfo['kind'], string> = {
  auto: 'Otomatik',
  manual: 'Manuel',
  import: 'İçe Aktarılan',
  safety: 'Muhafaza'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function SettingsPage({ role }: { role: User['role'] }): React.JSX.Element {
  const dataVer = useDataVersion()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [backupBusy, setBackupBusy] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)

  useEffect(() => {
    void window.api.getAppInfo().then(setInfo).catch(() => setInfo(null))
    void window.api.updateCheck().then((r) => setUpdateMsg(r.message)).catch(() => setUpdateMsg(null))
  }, [])

  useEffect(() => {
    void window.api
      .authMe()
      .then(setUser)
      .catch(() => setUser(null))
  }, [dataVer])

  const loadBackups = useCallback(async () => {
    setBackups(await window.api.backupsList())
  }, [dataVer])

  useEffect(() => {
    void loadBackups().catch((e) => setError(String(e)))
  }, [loadBackups])

  function changePassword(): void {
    setResult(null)
    setError(null)
    if (!current || !next) {
      setError('Mevcut ve yeni şifre girin')
      return
    }
    if (next.length < 4) {
      setError('Yeni şifre en az 4 karakter olmalı')
      return
    }
    if (next !== confirm) {
      setError('Yeni şifreler eşleşmiyor')
      return
    }
    setBusy(true)
    void window.api
      .authChangePassword(current, next)
      .then((res) => {
        if (res.ok) {
          setResult('Şifre değiştirildi.')
          setCurrent('')
          setNext('')
          setConfirm('')
        } else {
          setError(res.error ?? 'Şifre değiştirilemedi')
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  function doManualBackup(): void {
    setError(null)
    setResult(null)
    setBackupBusy(true)
    void window.api
      .backupCreate()
      .then(() => {
        setResult('Yedek alındı.')
        return loadBackups()
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBackupBusy(false))
  }

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!window.confirm(`"${file.name}" içeri aktarılacak. Devam et?`)) return
    setError(null)
    setResult(null)
    setBackupBusy(true)
    file
      .arrayBuffer()
      .then((buf) => window.api.backupImport(file.name, buf))
      .then(() => {
        setResult('Yedek içe aktarıldı. Geri yükleme için listeden seçin.')
        return loadBackups()
      })
      .catch((er) => setError(String(er)))
      .finally(() => setBackupBusy(false))
  }

  function doRestore(b: BackupInfo): void {
    if (
      !window.confirm(
        `${b.filename}\n\nBu yedek UYGULAMANIN TÜM VERİSİNİ değiştirir ve uygulama yeniden başlatılır.\nMevcut verin önce "Muhafaza" yedeği olarak saklanır.\n\nDevam edilsin mi?`
      )
    )
      return
    setError(null)
    setBackupBusy(true)
    void window.api
      .backupRestore(b.id)
      .then(() => {
        setResult('Geri yükleme tamamlandı, uygulama yeniden başlatılıyor…')
      })
      .catch((er) => {
        setError(String(er))
        setBackupBusy(false)
      })
  }

  const isAdmin = user?.role === 'admin'

  return (
    <div className="page">
      <header className="page-head">
        <h1>Ayarlar</h1>
      </header>

      {error && <p className="error">{error}</p>}
      {result && <p className="ok">{result}</p>}

      <div className="grid2">
        <div className="panel">
          <h3>Şifre Değiştir</h3>
          {user && (
            <p className="muted">
              Kullanıcı: <strong>{user.username}</strong> ({user.name})
            </p>
          )}
          <div className="form-col">
            <label className="form-field">
              Mevcut Şifre
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </label>
            <label className="form-field">
              Yeni Şifre (min 4 karakter)
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
            </label>
            <label className="form-field">
              Yeni Şifre (Tekrar)
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            <button className="btn primary" onClick={changePassword} disabled={busy}>
              {busy ? 'Kaydediliyor…' : 'Şifreyi Değiştir'}
            </button>
          </div>
        </div>

        <div className="panel">
          <h3>Sistem Bilgisi</h3>
          <dl className="kv">
            {info && (
              <>
                <div>
                  <dt>Uygulama</dt>
                  <dd>
                    {info.name} v{info.version}
                  </dd>
                </div>
                <div>
                  <dt>Platform</dt>
                  <dd>
                    {info.platform} ({info.arch})
                  </dd>
                </div>
                <div>
                  <dt>Veritabanı</dt>
                  <dd className="mono small">{info.dbPath}</dd>
                </div>
              </>
            )}
          </dl>
          <p className="muted">{updateMsg ?? 'Güncelleme durumu yüklenemedi.'}</p>
        </div>
      </div>

      {role === 'admin' && (
        <div className="panel">
          <div className="panel-row">
            <h3>Yedekleme</h3>
            <div className="btn-group">
              <button className="btn primary" onClick={doManualBackup} disabled={backupBusy || !isAdmin}>
                {backupBusy ? 'Çalışıyor…' : 'Yedek Al'}
              </button>
              <label className="btn">
                Dosyadan İçe Aktar
                <input type="file" accept=".db,.sqlite,.sqlite3,application/octet-stream" hidden onChange={onImportFile} />
              </label>
            </div>
          </div>
          <p className="muted">
            Uygulama her açılışta günde bir kez <strong>otomatik yedek</strong> alır (en son 30 tutulur). Manuel yedek
            tek tıkla alınır. Yedekler uygulamanın veri klasöründe <span className="mono small">backups/</span> altında
            SQLite dosyası olarak saklanır.
          </p>

          {!isAdmin && <p className="muted">Sadece yönetici yedek alabilir / geri yükleyebilir.</p>}

          {backups.length === 0 ? (
            <p className="muted">Henüz yedek yok.</p>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Tür</th>
                  <th>Boyut</th>
                  <th>Kaydeden</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.id}>
                    <td>{formatDateTime(b.createdAt)}</td>
                    <td>
                      <span className="badge">{KIND_LABEL[b.kind]}</span>{' '}
                      <span className="mono small">{b.filename}</span>
                    </td>
                    <td>{formatSize(b.size)}</td>
                    <td>{b.createdByName ?? '-'}</td>
                    <td className="row-actions">
                      <button
                        className="btn small"
                        disabled={!isAdmin || backupBusy}
                        onClick={() => doRestore(b)}
                      >
                        Geri Yükle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="panel">
        <h3>Uzaktan Güncelleme</h3>
        <p className="muted">
          Paketlenmiş sürümde (yalnızca asıl kurulum makinesinde) GitHub Releases üzerinden otomatik güncelleme
          çalışır; geliştirme sürümünde devre dışıdır. Yayın öncesi{' '}
          <span className="mono small">electron-builder.yml</span> içindeki <span className="mono small">owner</span>{' '}
          alanı GitHub kullanıcı adıyla doldurulmalıdır. Güncelleme yalnızca program kodunu değiştirir; SQLite verisine
          dokunmaz.
        </p>
      </div>
    </div>
  )
}