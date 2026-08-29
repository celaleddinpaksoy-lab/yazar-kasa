import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  PaymentMethod,
  Supplier,
  SupplierDetail,
  SupplierWithBalance
} from '@shared/types'
import Modal from '../components/Modal'
import { useDataVersion } from '../context/DataContext'
import {
  formatKurus,
  formatDate,
  kurusToTl,
  tlToKurus,
  todayInput,
  paymentMethodLabel
} from '../utils/format'

type Role = 'admin' | 'personel'

export default function SuppliersPage({ role }: { role: Role }): React.JSX.Element {
  const isAdmin = role === 'admin'
  const dataVer = useDataVersion()
  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([])
  const [detail, setDetail] = useState<SupplierDetail | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editNote, setEditNote] = useState('')
  const [debtAmount, setDebtAmount] = useState('')
  const [debtDate, setDebtDate] = useState(() => todayInput())
  const [debtNote, setDebtNote] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(() => todayInput())
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [payNote, setPayNote] = useState('')
  const [busy, setBusy] = useState(false)

  const loadList = useCallback(async () => {
    setSuppliers(await window.api.suppliersWithBalance())
  }, [dataVer])

  const loadSelected = useCallback(
    async (id: number) => {
      setDetail(await window.api.suppliersDetail(id))
    },
    [dataVer]
  )

  useEffect(() => {
    void loadList().catch((e) => setError(String(e)))
  }, [loadList])

  useEffect(() => {
    if (selectedId != null) void loadSelected(selectedId).catch((e) => setError(String(e)))
  }, [selectedId, loadSelected])

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr')
    if (!q) return suppliers
    return suppliers.filter((s) =>
      [s.name, s.phone ?? '', s.address ?? ''].some((v) => v.toLocaleLowerCase('tr').includes(q))
    )
  }, [suppliers, search])

  function select(id: number): void {
    setSelectedId((cur) => (cur === id ? null : id))
    if (selectedId === id) setDetail(null)
  }

  function createSupplier(): void {
    setError(null)
    setBusy(true)
    void window.api
      .suppliersCreate({ name: newName, phone: newPhone, address: newAddress })
      .then(() => {
        setNewOpen(false)
        setNewName('')
        setNewPhone('')
        setNewAddress('')
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  function openEdit(s: Supplier): void {
    setEditSupplier(s)
    setEditName(s.name)
    setEditPhone(s.phone ?? '')
    setEditAddress(s.address ?? '')
    setEditNote(s.note ?? '')
    setEditOpen(true)
  }

  function saveEdit(): void {
    if (!editSupplier) return
    setError(null)
    setBusy(true)
    void window.api
      .suppliersUpdate(editSupplier.id, {
        name: editName,
        phone: editPhone,
        address: editAddress,
        note: editNote
      })
      .then(() => setEditOpen(false))
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  function removeSupplier(s: Supplier): void {
    if (!window.confirm(`"${s.name}" silinsin mi? (Alış kaydı olan tedarikçi silinemez)`)) return
    setError(null)
    window.api
      .suppliersRemove(s.id)
      .catch((e) => setError(String(e)))
  }

  function addDebt(): void {
    if (selectedId == null) return
    setError(null)
    setBusy(true)
    void window.api
      .suppliersDebtAdd(selectedId, {
        amount: tlToKurus(debtAmount),
        date: debtDate,
        note: debtNote
      })
      .then((d) => {
        setDetail(d)
        setDebtAmount('')
        setDebtNote('')
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  function pay(): void {
    if (selectedId == null) return
    setError(null)
    setBusy(true)
    void window.api
      .suppliersPay(selectedId, {
        amount: tlToKurus(payAmount),
        date: payDate,
        paymentMethod: payMethod,
        note: payNote
      })
      .then((d) => {
        setDetail(d)
        setPayAmount('')
        setPayNote('')
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  function editMovement(id: number): void {
    const m = detail?.movements.find((x) => x.id === id && x.isManual)
    if (!m) return
    const note = window.prompt('Not (boş = tutar/düzenleme silinir):', m.note ?? '')
    if (note === null) return
    const amountTl = window.prompt('Tutar (TL):', kurusToTl(Math.abs(m.amount)))
    if (amountTl === null) return
    const isDebt = m.source === 'Manuel borç'
    setError(null)
    window.api
      .suppliersMovementEdit(id, {
        amount: tlToKurus(amountTl) * (isDebt ? 1 : 1),
        date: m.date,
        note
      })
      .then(setDetail)
      .catch((e) => setError(String(e)))
  }

  function removeMovement(id: number): void {
    if (!window.confirm('Bu manuel hareket silinsin mi?')) return
    setError(null)
    window.api
      .suppliersMovementRemove(id)
      .then(setDetail)
      .catch((e) => setError(String(e)))
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Tedarikçiler</h1>
        {isAdmin && (
          <button className="btn primary" onClick={() => setNewOpen(true)}>
            + Yeni Tedarikçi
          </button>
        )}
      </header>

      {error && <p className="error">{error}</p>}

      <div className="grid2">
        <div className="panel">
          <h3>Tedarikçi Listesi</h3>
          <input
            className="input"
            placeholder="Ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <table className="table">
            <thead>
              <tr>
                <th>Tedarikçi</th>
                <th>Bakiye</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  className={selectedId === s.id ? 'row-active' : ''}
                  onClick={() => select(s.id)}
                >
                  <td>
                    {s.name}
                    {s.phone && (
                      <span className="muted block" style={{ fontSize: '0.75rem' }}>
                        {s.phone}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={s.balance > 0 ? '' : 'credit'}>
                      {s.balance > 0 ? formatKurus(s.balance) : formatKurus(0)}
                    </span>
                    {s.balance < 0 && (
                      <span className="credit block" style={{ fontSize: '0.75rem' }}>
                        alacaklı: {formatKurus(-s.balance)}
                      </span>
                    )}
                  </td>
                  <td>
                    {isAdmin && (
                      <div className="row-actions">
                        <button onClick={(e) => { e.stopPropagation(); openEdit(s) }}>Düzenle</button>
                        <button className="danger" onClick={(e) => { e.stopPropagation(); removeSupplier(s) }}>
                          Sil
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    Tedarikçi yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel">
          {detail ? (
            <>
              <h3>{detail.supplier.name}</h3>
              <p className="muted">
                {detail.supplier.phone && `Tel: ${detail.supplier.phone} · `}
                {detail.supplier.address && `Adres: ${detail.supplier.address}`}
              </p>
              <dl className="kv">
                <div>
                  <dt>Güncel Bakiye</dt>
                  <dd className={detail.balance < 0 ? 'credit' : 'debt'}>
                    {detail.balance < 0 ? 'alacaklı ' : 'borç '}
                    {formatKurus(Math.abs(detail.balance))}
                  </dd>
                </div>
                <div>
                  <dt>Toplam Borç</dt>
                  <dd>{formatKurus(detail.totalDebt)}</dd>
                </div>
                <div>
                  <dt>Toplam Ödeme</dt>
                  <dd>{formatKurus(detail.totalPaid)}</dd>
                </div>
              </dl>

              {isAdmin && (
                <div className="grid2">
                  <div className="sub-panel">
                    <h4>Borç Ekle</h4>
                    <div className="form-col">
                      <input
                        placeholder="Tutar TL"
                        value={debtAmount}
                        onChange={(e) => setDebtAmount(e.target.value)}
                      />
                      <input
                        type="date"
                        value={debtDate}
                        onChange={(e) => setDebtDate(e.target.value)}
                      />
                      <input placeholder="Not" value={debtNote} onChange={(e) => setDebtNote(e.target.value)} />
                      <button className="btn" onClick={addDebt} disabled={busy}>
                        Borç Ekle
                      </button>
                    </div>
                  </div>
                  <div className="sub-panel">
                    <h4>Ödeme Al</h4>
                    <div className="form-col">
                      <input
                        placeholder="Tutar TL"
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                      />
                      <div className="btn-group">
                        {(['cash', 'card', 'transfer'] as PaymentMethod[]).map((m) => (
                          <button
                            key={m}
                            className={`seg ${payMethod === m ? 'active' : ''}`}
                            onClick={() => setPayMethod(m)}
                          >
                            {paymentMethodLabel(m)}
                          </button>
                        ))}
                      </div>
                      <input
                        type="date"
                        value={payDate}
                        onChange={(e) => setPayDate(e.target.value)}
                      />
                      <input placeholder="Not" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
                      <button className="btn" onClick={pay} disabled={busy}>
                        Ödeme Al
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <h4>Hareket Geçmişi</h4>
              <table className="table">
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>Tip</th>
                    <th>Tutar</th>
                    <th>Bakiye</th>
                    {isAdmin && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {detail.movements.map((m) => (
                    <tr key={m.id + m.createdAt + m.amount}>
                      <td>{formatDate(new Date(m.date + 'T00:00:00').getTime())}</td>
                      <td>
                        {m.source}
                        {m.note && <span className="muted block">{m.note}</span>}
                      </td>
                      <td className={m.amount < 0 ? 'credit' : 'debt'}>
                        {m.amount > 0 ? '+' : ''}
                        {formatKurus(m.amount)}
                      </td>
                      <td>{formatKurus(m.balanceAfter)}</td>
                      {isAdmin && (
                        <td>
                          {m.isManual && (
                            <div className="row-actions">
                              <button onClick={() => editMovement(m.id)}>Düzenle</button>
                              <button className="danger" onClick={() => removeMovement(m.id)}>
                                Sil
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="muted">Soldan bir tedarikçi seçin.</p>
          )}
        </div>
      </div>

      {newOpen && (
        <Modal onClose={() => setNewOpen(false)} title="Yeni Tedarikçi">
          <div className="form-col">
            <label className="form-field">
              Ad *
              <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            </label>
            <label className="form-field">
              Telefon
              <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            </label>
            <label className="form-field">
              Adres
              <input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} />
            </label>
            <button className="btn primary" onClick={createSupplier} disabled={busy || !newName.trim()}>
              Kaydet
            </button>
          </div>
        </Modal>
      )}

      {editOpen && editSupplier && (
        <Modal onClose={() => setEditOpen(false)} title="Tedarikçi Düzenle">
          <div className="form-col">
            <label className="form-field">
              Ad *
              <input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </label>
            <label className="form-field">
              Telefon
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
            </label>
            <label className="form-field">
              Adres
              <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
            </label>
            <label className="form-field">
              Not
              <input value={editNote} onChange={(e) => setEditNote(e.target.value)} />
            </label>
            <button className="btn primary" onClick={saveEdit} disabled={busy}>
              Kaydet
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}