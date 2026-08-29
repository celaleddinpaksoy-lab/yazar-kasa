import React, { useCallback, useEffect, useState } from 'react'
import type { CashShiftSummary } from '@shared/types'
import { useDataVersion } from '../context/DataContext'
import { formatKurus, formatDateTime, kurusToTl, tlToKurus } from '../utils/format'

export default function CashShiftPage(): React.JSX.Element {
  const dataVer = useDataVersion()
  const [open, setOpen] = useState<CashShiftSummary | null>(null)
  const [history, setHistory] = useState<CashShiftSummary[]>([])
  const [opening, setOpening] = useState('')
  const [openNote, setOpenNote] = useState('')
  const [closing, setClosing] = useState('')
  const [closeNote, setCloseNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [o, h] = await Promise.all([window.api.cashGetOpen(), window.api.cashList()])
    setOpen(o)
    setHistory(h)
  }, [dataVer])

  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [load])

  function doOpen(): void {
    setError(null)
    void window.api
      .cashOpen({ openingBalance: tlToKurus(opening), note: openNote })
      .then((shift) => {
        setOpen(shift)
        setOpening('')
        setOpenNote('')
        return load()
      })
      .catch((e) => setError(String(e)))
  }

  function doClose(): void {
    if (!open) return
    setError(null)
    setBusy(true)
    void window.api
      .cashClose(open.id, { closingBalance: tlToKurus(closing), note: closeNote })
      .then(() => {
        setClosing('')
        setCloseNote('')
        setOpen(null)
        return load()
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  const closingKurus = tlToKurus(closing)
  const expectedNow = open ? open.openingBalance + open.cashIn : 0
  const liveDiff = closingKurus - expectedNow

  return (
    <div className="page">
      <header className="page-head">
        <h1>Kasa Açılış / Kapanış</h1>
      </header>

      {error && <p className="error">{error}</p>}

      {!open && (
        <div className="panel">
          <h3>Kasayı Aç</h3>
          <p className="muted">Gün başı kasada bulunan para (TL).</p>
          <form
            className="form-col"
            onSubmit={(e) => {
              e.preventDefault()
              doOpen()
            }}
          >
            <label className="form-field">
              Açılış Parası
              <input
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                placeholder="0,00"
                autoFocus
              />
            </label>
            <label className="form-field">
              Not (opsiyonel)
              <input value={openNote} onChange={(e) => setOpenNote(e.target.value)} />
            </label>
            <button className="btn primary" type="submit">
              Kasayı Aç
            </button>
          </form>
        </div>
      )}

      {open && (
        <div className="grid2">
          <div className="panel">
            <h3>Açık Kasa</h3>
            <dl className="kv">
              <div>
                <dt>Açılış</dt>
                <dd>{formatDateTime(open.openedAt)}</dd>
              </div>
              <div>
                <dt>Açan</dt>
                <dd>{open.openedByName}</dd>
              </div>
              <div>
                <dt>Açılış Parası</dt>
                <dd>{formatKurus(open.openingBalance)}</dd>
              </div>
              <div>
                <dt>Nakit Ödeme (güncel)</dt>
                <dd>{formatKurus(open.cashIn)}</dd>
              </div>
              <div>
                <dt>Toplam Satış (tüm ödeme)</dt>
                <dd>{formatKurus(open.totalSales)}</dd>
              </div>
              <div>
                <dt>İşlem Adedi</dt>
                <dd>{open.salesCount}</dd>
              </div>
              <div>
                <dt className="strong">Beklenen Bakiye</dt>
                <dd className="strong">{formatKurus(expectedNow)}</dd>
              </div>
            </dl>
          </div>

          <div className="panel">
            <h3>Kasa Kapat (Gün Sonu Sayım)</h3>
            <p className="muted">
              Beklenen bakiye <strong>{formatKurus(expectedNow)}</strong>. Kasada fiilen saydığınız
              parayı girin; fark otomatik hesaplanır.
            </p>
            <form
              className="form-col"
              onSubmit={(e) => {
                e.preventDefault()
                doClose()
              }}
            >
              <label className="form-field">
                Sayılan Para (fiili)
                <input
                  value={closing}
                  onChange={(e) => setClosing(e.target.value)}
                  placeholder="0,00"
                  autoFocus
                />
              </label>
              <label className="form-field">
                Not (opsiyonel)
                <input value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />
              </label>
              {closingKurus > 0 && (
                <div className={`diff-preview ${liveDiff === 0 ? 'ok' : liveDiff > 0 ? 'plus' : 'minus'}`}>
                  Fark: {liveDiff >= 0 ? '+' : '−'}
                  {formatKurus(Math.abs(liveDiff))}
                  {liveDiff === 0 ? ' (tam uzlaşma)' : liveDiff > 0 ? ' (fazla)' : ' (eksik)'}
                </div>
              )}
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'Kapanıyor…' : 'Kasayı Kapat'}
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="panel">
        <h3>Kasa Geçmişi</h3>
        {history.length === 0 ? (
          <p className="muted">Henüz kasa kaydı yok.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Açılış</th>
                <th>Kapanış</th>
                <th>Açılış Parası</th>
                <th>Beklenen</th>
                <th>Fiili</th>
                <th>Fark</th>
                <th>Not</th>
              </tr>
            </thead>
            <tbody>
              {history.map((s) => (
                <tr key={s.id}>
                  <td>{formatDateTime(s.openedAt)}</td>
                  <td>{s.closedAt ? formatDateTime(s.closedAt) : <em>Açık</em>}</td>
                  <td>{formatKurus(s.openingBalance)}</td>
                  <td>
                    {s.expectedBalance != null ? formatKurus(s.expectedBalance) : formatKurus(s.openingBalance + s.cashIn)}
                  </td>
                  <td>{s.closingBalance != null ? formatKurus(s.closingBalance) : '—'}</td>
                  <td>
                    {s.difference != null ? (
                      <span className={s.difference === 0 ? 'diff-ok' : s.difference > 0 ? 'diff-plus' : 'diff-minus'}>
                        {s.difference >= 0 ? '+' : '−'}
                        {formatKurus(Math.abs(s.difference))}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{s.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}