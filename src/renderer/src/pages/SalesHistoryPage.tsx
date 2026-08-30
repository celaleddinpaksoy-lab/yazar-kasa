import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  Role,
  SaleHistoryDetail,
  SalesHistoryItem
} from '@shared/types'
import { useDataVersion } from '../context/DataContext'
import Modal from '../components/Modal'
import {
  formatKurus,
  formatDateTime,
  paymentMethodLabel
} from '../utils/format'

function msToLocalInput(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function localInputToMs(v: string): number {
  const t = new Date(v)
  return Number.isNaN(t.getTime()) ? 0 : t.getTime()
}

export default function SalesHistoryPage({ role }: { role: Role }): React.JSX.Element {
  const isAdmin = role === 'admin'
  const dataVer = useDataVersion()

  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rows, setRows] = useState<SalesHistoryItem[]>([])
  const [detail, setDetail] = useState<SaleHistoryDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const query: { search?: string; from?: number; to?: number } = {}
      if (search.trim()) query.search = search.trim()
      if (from) query.from = new Date(`${from}T00:00:00`).getTime()
      if (to) query.to = new Date(`${to}T23:59:59`).getTime()
      setRows(await window.api.salesHistory(query))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [search, from, to])

  useEffect(() => {
    load()
  }, [load, dataVer])

  const refreshDetail = useCallback(async (): Promise<void> => {
    if (!detail) return
    try {
      setDetail(await window.api.salesHistoryDetail(detail.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [detail])

  useEffect(() => {
    refreshDetail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVer])

  const openDetail = async (id: number): Promise<void> => {
    try {
      setDetail(await window.api.salesHistoryDetail(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const [editDate, setEditDate] = useState<string | null>(null)
  const [editCust, setEditCust] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  async function saveDate(): Promise<void> {
    if (!detail || editDate == null) return
    const ms = localInputToMs(editDate)
    if (ms <= 0) {
      setError('Geçersiz tarih')
      return
    }
    setBusy(true)
    try {
      setDetail(await window.api.salesHistoryUpdateDate(detail.id, ms))
      setEditDate(null)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveCustomer(): Promise<void> {
    if (!detail || editCust == null) return
    const parsed = editCust.trim()
    const customerId = parsed === '' ? null : Number(parsed)
    setBusy(true)
    try {
      setDetail(await window.api.salesHistoryUpdateCustomer(detail.id, customerId))
      setEditCust(null)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function doDelete(): Promise<void> {
    if (!detail) return
    setBusy(true)
    try {
      const res = await window.api.salesHistoryDelete(detail.id)
      if (!res.ok) {
        setError(res.error ?? 'Silme başarısız')
      } else {
        setError(res.message ?? null)
        setDetail(null)
        setConfirmDelete(false)
        load()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const totals = useMemo(
    () => ({
      count: rows.length,
      total: rows.reduce((s, r) => s + r.total, 0),
      debt: rows.reduce((s, r) => s + r.debtAmount, 0)
    }),
    [rows]
  )

  return (
    <div className="page">
      <h1>Satış Geçmişi</h1>
      <p className="muted">Fişleri görüntüleyin; düzenleme/silme yalnızca yönetici.</p>

      <div className="toolbar">
        <input
          className="input"
          placeholder="Fiş no veya müşteri ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label>
          Başlangıç
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Bitiş
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="btn primary" onClick={() => load()}>
          Filtrele
        </button>
      </div>

      {error && <p className="error-box">{error}</p>}

      <div className="summary-row">
        <span>
          {totals.count} satış · Toplam <strong>{formatKurus(totals.total)}</strong> · Açık borç{' '}
          <strong>{formatKurus(totals.debt)}</strong>
        </span>
      </div>

      <table className="grid">
        <thead>
          <tr>
            <th>Tarih</th>
            <th>Fiş No</th>
            <th>Müşteri</th>
            <th>Toplam</th>
            <th>Ödenen</th>
            <th>Borç</th>
            <th>İade/Değişim</th>
            <th>Oluşturan</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{formatDateTime(r.createdAt)}</td>
              <td>{r.receiptNo}</td>
              <td>{r.customerName ?? 'Anonim'}</td>
              <td>{formatKurus(r.total)}</td>
              <td>{formatKurus(r.paidAmount)}</td>
              <td className={r.debtAmount > 0 ? 'debt' : ''}>{formatKurus(r.debtAmount)}</td>
              <td>
                {r.returnsCount > 0 || r.exchangesCount > 0
                  ? `${r.returnsCount} İ / ${r.exchangesCount} D`
                  : '—'}
              </td>
              <td>{r.createdByName ?? '—'}</td>
              <td>
                <button className="btn" onClick={() => openDetail(r.id)}>
                  Detay
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="muted">
                Kayıt bulunamadı.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {detail && (
        <Modal
          title={`Fiş ${detail.receiptNo}`}
          onClose={() => {
            setDetail(null)
            setEditDate(null)
            setEditCust(null)
          }}
        >
          <div className="float-row">
            <div>
              <strong>{detail.customerName ?? 'Anonim Müşteri'}</strong>
              <br />
              <span className="muted">{formatDateTime(detail.createdAt)}</span>
            </div>
            <div
              className="bal"
              style={{ alignSelf: 'center', fontSize: '1.2rem' }}
            >
              {detail.debtAmount > 0 ? 'Borçlu' : 'Ödendi'}
            </div>
          </div>

          <table className="grid">
            <thead>
              <tr>
                <th>Ürün</th>
                <th>Adet</th>
                <th>Birim</th>
                <th>Tutar</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((it, i) => (
                <tr key={i}>
                  <td>{it.name}</td>
                  <td>{it.quantity}</td>
                  <td>{formatKurus(it.unitPrice)}</td>
                  <td>{formatKurus(it.lineTotal)}</td>
                </tr>
              ))}
              {detail.discountTotal > 0 && (
                <tr>
                  <td colSpan={3}>İndirim</td>
                  <td>−{formatKurus(detail.discountTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="r-tot">
            <div className="r-line strong">
              <span>TOPLAM</span>
              <span>{formatKurus(detail.total)}</span>
            </div>
            {detail.payments.map((p) => (
              <div className="r-line" key={p.method}>
                <span>{paymentMethodLabel(p.method)}</span>
                <span>{formatKurus(p.amount)}</span>
              </div>
            ))}
            {detail.debtAmount > 0 && (
              <div className="r-line debt">
                <span>Kalan Borç</span>
                <span>{formatKurus(detail.debtAmount)}</span>
              </div>
            )}
          </div>

          {isAdmin && (
            <div className="actions-row">
              {editDate != null ? (
                <div className="float-row">
                  <input
                    type="datetime-local"
                    className="input"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                  />
                  <button className="btn primary" onClick={saveDate} disabled={busy}>
                    Kaydet
                  </button>
                  <button className="btn" onClick={() => setEditDate(null)}>
                    Vazgeç
                  </button>
                </div>
              ) : (
                <button
                  className="btn"
                  onClick={() => setEditDate(msToLocalInput(detail.createdAt))}
                >
                  Tarihi Düzenle
                </button>
              )}

              {editCust != null ? (
                <div className="float-row">
                  <input
                    className="input"
                    placeholder="Müşteri ID (boş = anonim)"
                    value={editCust}
                    onChange={(e) => setEditCust(e.target.value)}
                  />
                  <button className="btn primary" onClick={saveCustomer} disabled={busy}>
                    Kaydet
                  </button>
                  <button className="btn" onClick={() => setEditCust(null)}>
                    Vazgeç
                  </button>
                </div>
              ) : (
                <button
                  className="btn"
                  onClick={() => setEditCust(String(detail.customerId ?? ''))}
                >
                  Müşteriyi Değiştir
                </button>
              )}

              {confirmDelete ? (
                <div className="float-row danger">
                  <span>Kalıcı silinsin mi? İade/değişimler de geri alınır.</span>
                  <button className="btn danger" onClick={doDelete} disabled={busy}>
                    Evet, Sil
                  </button>
                  <button className="btn" onClick={() => setConfirmDelete(false)}>
                    Vazgeç
                  </button>
                </div>
              ) : (
                <button className="btn danger" onClick={() => setConfirmDelete(true)}>
                  Satışı Sil
                </button>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
