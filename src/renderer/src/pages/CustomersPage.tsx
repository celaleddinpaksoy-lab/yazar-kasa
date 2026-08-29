import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  CustomerDetail,
  CustomerMovement,
  CustomerWithBalance,
  PaymentMethod
} from '@shared/types'
import Modal from '../components/Modal'
import { useDataVersion } from '../context/DataContext'
import {
  formatKurus,
  formatDate,
  formatDateTime,
  kurusToTl,
  tlToKurus,
  todayInput,
  paymentMethodLabel
} from '../utils/format'

type Role = 'admin' | 'personel'

function movementLabel(m: CustomerMovement): string {
  if (m.isManual) return m.amount >= 0 ? 'Manuel borç' : 'Ödeme'
  if (m.source === 'sale') return 'Veresiye satış'
  return m.amount >= 0 ? 'Borç' : 'Ödeme'
}

export default function CustomersPage({ role }: { role: Role }): React.JSX.Element {
  const isAdmin = role === 'admin'
  const dataVer = useDataVersion()
  const [customers, setCustomers] = useState<CustomerWithBalance[]>([])
  const [detail, setDetail] = useState<CustomerDetail | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [newCust, setNewCust] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newDay, setNewDay] = useState('')
  const [editCust, setEditCust] = useState(false)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editDay, setEditDay] = useState('')
  const [debtAmount, setDebtAmount] = useState('')
  const [debtDate, setDebtDate] = useState(() => todayInput())
  const [debtNote, setDebtNote] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(() => todayInput())
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [payNote, setPayNote] = useState('')
  const [busy, setBusy] = useState(false)

  const loadCustomers = useCallback(async () => {
    const list = await window.api.customersWithBalance()
    setCustomers(list)
    return list
  }, [dataVer])

  const loadSelected = useCallback(
    async (id: number) => {
      setDetail(await window.api.customersDetail(id))
    },
    [dataVer]
  )

  useEffect(() => {
    void loadCustomers().catch((e) => setError(String(e)))
  }, [loadCustomers])

  useEffect(() => {
    if (selectedId != null) void loadSelected(selectedId).catch((e) => setError(String(e)))
  }, [selectedId, loadSelected])

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr')
    if (!q) return customers
    return customers.filter(
      (c) =>
        c.name.toLocaleLowerCase('tr').includes(q) ||
        (c.phone ?? '').includes(q)
    )
  }, [customers, search])

  function pickCustomer(id: number): void {
    setSelectedId(id)
    setError(null)
  }

  function createCustomer(): void {
    if (!newName.trim()) return
    setError(null)
    void window.api
      .customersCreate({ name: newName, phone: newPhone, installmentDay: dayOrNull(newDay) })
      .then(async (c) => {
        await loadCustomers()
        setSelectedId(c.id)
        setNewCust(false)
        setNewName('')
        setNewPhone('')
        setNewDay('')
      })
      .catch((e) => setError(String(e)))
  }

  function openEdit(): void {
    if (!detail) return
    setEditName(detail.customer.name)
    setEditPhone(detail.customer.phone ?? '')
    setEditNote(detail.customer.note ?? '')
    setEditDay(detail.customer.installmentDay != null ? String(detail.customer.installmentDay) : '')
    setEditCust(true)
  }

  function saveEdit(): void {
    if (!detail) return
    setError(null)
    void window.api
      .customersUpdate(detail.customer.id, {
        name: editName,
        phone: editPhone,
        note: editNote,
        installmentDay: dayOrNull(editDay)
      })
      .then(async () => {
        await loadCustomers()
        await loadSelected(detail.customer.id)
        setEditCust(false)
      })
      .catch((e) => setError(String(e)))
  }

  function addDebt(): void {
    if (!detail) return
    setError(null)
    const amount = tlToKurus(debtAmount)
    if (amount <= 0) {
      setError('Borç tutarı girin')
      return
    }
    setBusy(true)
    void window.api
      .customersDebtAdd(detail.customer.id, { amount, date: debtDate, note: debtNote })
      .then(async (d) => {
        setDetail(d)
        setDebtAmount('')
        setDebtNote('')
        setDebtDate(todayInput())
        await loadCustomers()
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  function payDebt(): void {
    if (!detail) return
    setError(null)
    const amount = tlToKurus(payAmount)
    if (amount <= 0) {
      setError('Ödeme tutarı girin')
      return
    }
    if (
      amount > detail.balance &&
      !window.confirm(`Tutar borçtan (${formatKurus(detail.balance)}) fazla. Yine de işlensin mi?`)
    )
      return
    setBusy(true)
    void window.api
      .customersDebtPay(detail.customer.id, {
        amount,
        date: payDate,
        paymentMethod: payMethod,
        note: payNote
      })
      .then(async (d) => {
        setDetail(d)
        setPayAmount('')
        setPayNote('')
        setPayDate(todayInput())
        await loadCustomers()
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  function editMovement(m: CustomerMovement): void {
    const next = window.prompt(
      `Tutar (TL, +/- işaretli) ve tarih (GG.AA.YYYY)\nMevcut: ${formatKurus(m.amount)} (${m.date})`,
      `${kurusToTl(m.amount)}, ${m.date.split('-').reverse().join('.')}`
    )
    if (!next) return
    setBusy(true)
    const [amountPart, datePart] = next.split(',').map((s) => s.trim())
    const date = datePart
      ? datePart.split('.').reverse().join('-')
      : m.date
    void window.api
      .customersMovementEdit(
        m.id,
        { amount: tlToKurus(amountPart), date, note: m.note ?? undefined }
      )
      .then(async (d) => {
        setDetail(d)
        await loadCustomers()
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  function removeMovement(m: CustomerMovement): void {
    if (!window.confirm('Bu manuel hareket silinsin mi?')) return
    setBusy(true)
    void window.api
      .customersMovementRemove(m.id)
      .then(async (d) => {
        setDetail(d)
        await loadCustomers()
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="page cust-page">
      <header className="page-head">
        <h1>Müşteriler & Borç Defteri</h1>
        {!isAdmin && <span className="muted">Yönetici oturumu değil — borçlar salt okunur.</span>}
      </header>

      {error && <p className="error">{error}</p>}

      <div className="cust-layout">
        <aside className="panel cust-list">
          <input
            className="input"
            placeholder="Müşteri ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="cust-scroll">
            {filtered.map((c) => (
              <button
                key={c.id}
                className={`cust-item ${selectedId === c.id ? 'active' : ''}`}
                onClick={() => pickCustomer(c.id)}
              >
                <span className="ci-name">
                  {c.name}
                  {dueBadge(c)}
                </span>
                <span
                  className={`ci-balance ${c.balance > 0 ? 'debt' : c.balance < 0 ? 'credit' : ''}`}
                >
                  {formatKurus(c.balance)}
                </span>
              </button>
            ))}
            {filtered.length === 0 && <p className="muted">Müşteri yok.</p>}
          </div>
          <button className="btn primary block" onClick={() => setNewCust(true)}>
            + Yeni Müşteri
          </button>
        </aside>

        <section className="cust-detail">
          {!detail && <p className="muted">Soldan bir müşteri seçin.</p>}
          {detail && (
            <>
              <div className="panel">
                <div className="cust-head">
                  <div>
                    <h2>{detail.customer.name}</h2>
                    <p className="muted">
                      {detail.customer.phone ? `Tel: ${detail.customer.phone}` : 'Tel yok'}
                      {detail.customer.note ? ` · ${detail.customer.note}` : ''}
                      {detail.customer.installmentDay
                        ? ` · Aylık taksit vade günü: ${detail.customer.installmentDay}`
                        : ''}
                    </p>
                  </div>
                  <div>
                    <button className="btn small" onClick={openEdit}>
                      Düzenle
                    </button>
                  </div>
                </div>
                <div className="stat-row">
                  <div>
                    <dt>Toplam Satış / Borç</dt>
                    <dd>{formatKurus(detail.totalDebt)}</dd>
                  </div>
                  <div>
                    <dt>Ödenen</dt>
                    <dd>{formatKurus(detail.totalPaid)}</dd>
                  </div>
                  <div>
                    <dt>Kalan</dt>
                    <dd className={detail.balance > 0 ? 'debt' : detail.balance < 0 ? 'credit' : ''}>
                      {formatKurus(detail.balance)}
                    </dd>
                  </div>
                </div>
              </div>

              {isAdmin && (
                <div className="panel grid2c">
                  <form
                    className="form-col"
                    onSubmit={(e) => {
                      e.preventDefault()
                      addDebt()
                    }}
                  >
                    <h3>Manuel Borç Ekle</h3>
                    <label className="form-field">
                      Tutar (TL)
                      <input
                        value={debtAmount}
                        onChange={(e) => setDebtAmount(e.target.value)}
                        placeholder="0,00"
                      />
                    </label>
                    <label className="form-field">
                      Tarih
                      <input
                        type="date"
                        value={debtDate}
                        onChange={(e) => setDebtDate(e.target.value)}
                      />
                    </label>
                    <label className="form-field">
                      Açıklama
                      <input
                        value={debtNote}
                        onChange={(e) => setDebtNote(e.target.value)}
                      />
                    </label>
                    <button className="btn primary" type="submit" disabled={busy}>
                      Borç Ekle
                    </button>
                  </form>

                  <form
                    className="form-col"
                    onSubmit={(e) => {
                      e.preventDefault()
                      payDebt()
                    }}
                  >
                    <h3>Ödeme Al</h3>
                    <label className="form-field">
                      Tutar (TL)
                      <input
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        placeholder="0,00"
                      />
                    </label>
                    <label className="form-field">
                      Tarih
                      <input
                        type="date"
                        value={payDate}
                        onChange={(e) => setPayDate(e.target.value)}
                      />
                    </label>
                    <label className="form-field">
                      Ödeme Tipi
                      <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}>
                        {(['cash', 'card', 'transfer'] as PaymentMethod[]).map((m) => (
                          <option key={m} value={m}>
                            {paymentMethodLabel(m)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="form-field">
                      Açıklama
                      <input value={payNote} onChange={(e) => setPayNote(e.target.value)} />
                    </label>
                    <button className="btn primary" type="submit" disabled={busy}>
                      Ödeme Al
                    </button>
                  </form>
                </div>
              )}

              <div className="panel">
                <h3>Hareket Geçmişi</h3>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Tarih</th>
                      <th>Tip</th>
                      <th>Tutar</th>
                      <th>Bakiye</th>
                      <th>Açıklama</th>
                      {isAdmin && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.movements.map((m) => (
                      <tr key={m.id}>
                        <td>{formatDate(new Date(m.date + 'T12:00:00').getTime())}</td>
                        <td>{movementLabel(m)}</td>
                        <td className={m.amount > 0 ? 'debt' : 'credit'}>
                          {m.amount > 0 ? '+' : '−'}
                          {formatKurus(Math.abs(m.amount))}
                        </td>
                        <td>{formatKurus(m.balanceAfter)}</td>
                        <td>
                          {m.note ?? ''}
                          {m.paymentMethod && m.amount < 0 ? ` (${paymentMethodLabel(m.paymentMethod)})` : ''}
                        </td>
                        {isAdmin &&
                          (m.isManual ? (
                            <td className="actions">
                              <button className="btn tiny" onClick={() => editMovement(m)}>
                                Düzenle
                              </button>
                              <button className="btn tiny danger" onClick={() => removeMovement(m)}>
                                Sil
                              </button>
                            </td>
                          ) : (
                            <td>
                              <span className="muted" title="Otomatik satış kaydı, düzenlenemez">
                                🔒{/* otomatik */}
                              </span>
                            </td>
                          ))}
                      </tr>
                    ))}
                    {detail.movements.length === 0 && (
                      <tr>
                        <td colSpan={6}>Hareket yok.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      {newCust && (
        <Modal title="Yeni Müşteri" onClose={() => setNewCust(false)}>
          <form
            className="form-col"
            onSubmit={(e) => {
              e.preventDefault()
              createCustomer()
            }}
          >
            <label className="form-field">
              Ad Soyad
              <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            </label>
            <label className="form-field">
              Telefon (opsiyonel)
              <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            </label>
            <label className="form-field">
              Aylık taksit vade günü (1-31, boş = hatırlatma yok)
              <input
                type="number"
                min={1}
                max={31}
                value={newDay}
                onChange={(e) => setNewDay(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setNewCust(false)}>
                Vazgeç
              </button>
              <button type="submit" className="btn primary" disabled={!newName.trim()}>
                Kaydet
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editCust && detail && (
        <Modal title="Müşteriyi Düzenle" onClose={() => setEditCust(false)}>
          <form
            className="form-col"
            onSubmit={(e) => {
              e.preventDefault()
              saveEdit()
            }}
          >
            <label className="form-field">
              Ad Soyad
              <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
            </label>
            <label className="form-field">
              Telefon
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
            </label>
            <label className="form-field">
              Not
              <input value={editNote} onChange={(e) => setEditNote(e.target.value)} />
            </label>
            <label className="form-field">
              Aylık taksit vade günü (1-31)
              <input
                type="number"
                min={1}
                max={31}
                value={editDay}
                onChange={(e) => setEditDay(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setEditCust(false)}>
                Vazgeç
              </button>
              <button type="submit" className="btn primary" disabled={!editName.trim()}>
                Kaydet
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function dayOrNull(day: string): number | null {
  const d = Number(day)
  return day.trim() === '' || !Number.isFinite(d) || d < 1 || d > 31 ? null : Math.round(d)
}

function dueBadge(c: CustomerWithBalance): React.JSX.Element | null {
  if (c.installmentDay == null) return null
  const today = new Date()
  if (c.balance <= 0) return <span className="badge ok">Güncel</span>
  const overdue = today.getDate() >= c.installmentDay
  return overdue ? (
    <span className="badge overdue">Vadesi geçti</span>
  ) : (
    <span className="badge neutral">Vade {c.installmentDay}</span>
  )
}