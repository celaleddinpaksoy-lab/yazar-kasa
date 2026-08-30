import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  PaymentMethod,
  Product,
  PurchaseDetail,
  PurchaseKind,
  PurchaseSummary,
  Supplier,
  SupplierPayment,
  SupplierWithBalance
} from '@shared/types'
import Modal from '../components/Modal'
import { useDataVersion } from '../context/DataContext'
import {
  formatKurus,
  formatDate,
  todayInput,
  paymentMethodLabel,
  tlToKurus,
  kurusToTl,
  formatQty
} from '../utils/format'

type Role = 'admin' | 'personel'

interface PurchaseLine {
  productId: number
  name: string
  barcode: string
  qty: number
  unitCost: number
}

function lineTotal(l: PurchaseLine): number {
  return Math.round(l.unitCost * l.qty)
}

function kindLabel(k: PurchaseKind): string {
  return k === 'supplier_return' ? 'Tedarikçi İadesi' : 'Alış'
}

export default function PurchasesPage({ role }: { role: Role }): React.JSX.Element {
  const isAdmin = role === 'admin'
  const dataVer = useDataVersion()
  const [mode, setMode] = useState<'purchase' | 'supplier_return' | 'pay_only'>('purchase')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [balances, setBalances] = useState<SupplierWithBalance[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [lines, setLines] = useState<PurchaseLine[]>([])
  const [paidAmount, setPaidAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>('cash')
  const [note, setNote] = useState('')
  const [history, setHistory] = useState<PurchaseSummary[]>([])
  const [payments, setPayments] = useState<SupplierPayment[]>([])
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [payNote, setPayNote] = useState('')
  const [selected, setSelected] = useState<PurchaseDetail | null>(null)
  const [editTarget, setEditTarget] = useState<PurchaseDetail | null>(null)
  const [editItems, setEditItems] = useState<PurchaseLine[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [sList, pList, payList, balList] = await Promise.all([
      window.api.suppliersList(),
      window.api.purchasesList(),
      window.api.suppliersPayments(),
      window.api.suppliersWithBalance()
    ])
    setSuppliers(sList)
    setHistory(pList)
    setPayments(payList)
    setBalances(balList)
  }, [dataVer])

  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [load])

  const total = useMemo(() => lines.reduce((s, l) => s + lineTotal(l), 0), [lines])
  const payKurus = tlToKurus(paidAmount)
  const debtAmount = mode === 'purchase' ? Math.max(total - payKurus, 0) : 0

  function addLine(p: Product): void {
    const found = lines.find((l) => l.productId === p.id)
    if (found) {
      setLines((prev) => prev.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l)))
    } else {
      setLines((prev) => [
        ...prev,
        { productId: p.id, name: p.name, barcode: p.barcode, qty: 1, unitCost: p.purchasePrice }
      ])
    }
  }

  function setQty(productId: number, qty: number): void {
    setLines((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, qty: Math.max(0, qty) } : l))
    )
  }

  function setCost(productId: number, tl: string): void {
    setLines((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, unitCost: tlToKurus(tl) } : l))
    )
  }

  function removeLine(productId: number): void {
    setLines((prev) => prev.filter((l) => l.productId !== productId))
  }

  function doComplete(): void {
    setError(null)
    if (!lines.some((l) => l.qty > 0)) {
      setError('En az bir kalem girin')
      return
    }
    if (total <= 0) {
      setError('Toplam tutar sıfır olamaz')
      return
    }
    if (mode === 'purchase' && payKurus > 0 && !paymentMethod) {
      setError('Ödeme yöntemi seçin')
      return
    }
    if (mode === 'purchase' && payKurus > total) {
      setError('Ödenen tutar toplamı aşamaz')
      return
    }
    if (mode === 'purchase' && payKurus < total && !supplierId) {
      setError('Eksik ödemeli alış için tedarikçi gerekir')
      return
    }
    if (mode === 'supplier_return' && !supplierId) {
      setError('Tedarikçi iadesi için tedarikçi gerekir')
      return
    }

    const items = lines
      .filter((l) => l.qty > 0)
      .map((l) => ({ productId: l.productId, quantity: mode === 'supplier_return' ? -l.qty : l.qty, unitCost: l.unitCost }))

    const payload = {
      supplierId: supplierId ? Number(supplierId) : null,
      items,
      paidAmount: mode === 'purchase' ? payKurus : 0,
      paymentMethod: mode === 'purchase' ? paymentMethod : null,
      note
    }

    setBusy(true)
    const call =
      mode === 'supplier_return'
        ? window.api.purchasesSupplierReturn(payload)
        : window.api.purchasesComplete(payload)
    void call
      .then((res) => {
        if (!res.ok) {
          setError(res.error ?? 'Kayıt başarısız')
          return
        }
        setLines([])
        setSupplierId('')
        setPaidAmount('')
        setNote('')
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  async function openDetail(p: PurchaseSummary): Promise<void> {
    try {
      setSelected(await window.api.purchasesDetail(p.id))
    } catch (e) {
      setError(String(e))
    }
  }

  function startEdit(p: PurchaseSummary): void {
    if (p.kind !== 'purchase') return
    void window.api
      .purchasesDetail(p.id)
      .then((d) => {
        setEditTarget(d)
        setEditItems(
          d.items.map((it) => ({
            productId: it.productId,
            name: it.name,
            barcode: it.barcode,
            qty: it.quantity,
            unitCost: it.unitCost
          }))
        )
      })
      .catch((e) => setError(String(e)))
  }

  function editSetQty(productId: number, qty: number): void {
    setEditItems((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, qty: Math.max(0, qty) } : l))
    )
  }

  function editSetCost(productId: number, tl: string): void {
    setEditItems((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, unitCost: tlToKurus(tl) } : l))
    )
  }

  function editRemoveLine(productId: number): void {
    setEditItems((prev) => prev.filter((l) => l.productId !== productId))
  }

  function editAddLine(p: Product): void {
    const found = editItems.find((l) => l.productId === p.id)
    if (found) {
      setEditItems((prev) => prev.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l)))
    } else {
      setEditItems((prev) => [
        ...prev,
        { productId: p.id, name: p.name, barcode: p.barcode, qty: 1, unitCost: p.purchasePrice }
      ])
    }
  }

  function saveEdit(): void {
    if (!editTarget) return
    const items = editItems
      .filter((l) => l.qty > 0)
      .map((l) => ({ productId: l.productId, quantity: l.qty, unitCost: l.unitCost }))
    if (!items.length) {
      setError('En az bir kalem gerekir')
      return
    }
    setError(null)
    setBusy(true)
    void window.api
      .purchasesUpdate(editTarget.purchase.id, {
        supplierId: null,
        items,
        paidAmount: 0,
        paymentMethod: null,
        note: editTarget.purchase.note ?? undefined
      })
      .then((res) => {
        if (!res.ok) {
          setError(res.error ?? 'Güncelleme başarısız')
          return
        }
        setEditTarget(null)
        setEditItems([])
      })
      .catch((e2) => setError(String(e2)))
      .finally(() => setBusy(false))
  }

  function removePurchase(p: PurchaseSummary): void {
    if (
      !window.confirm(
        `${p.purchaseNo} silinsin mi? Stok geri çevrilir, bağlı ödemeler silinir.`
      )
    ) {
      return
    }
    setError(null)
    void window.api
      .purchasesRemove(p.id)
      .catch((e) => setError(String(e)))
  }

  function filteredLines(): PurchaseLine[] {
    const q = search.trim().toLocaleLowerCase('tr')
    if (!q) return lines
    return lines.filter((l) => l.name.toLocaleLowerCase('tr').includes(q))
  }

  function doPay(): void {
    setError(null)
    if (!supplierId) {
      setError('Ödeme için tedarikçi seçin')
      return
    }
    const amount = tlToKurus(payAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Ödeme tutarı girin')
      return
    }
    setBusy(true)
    void window.api
      .suppliersPay(Number(supplierId), {
        amount,
        date: todayInput(),
        paymentMethod: payMethod,
        note: payNote || undefined
      })
      .then(() => {
        setPayAmount('')
        setPayNote('')
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  const chosenBalance = balances.find((b) => b.id === Number(supplierId))?.balance

  return (
    <div className="page">
      <header className="page-head">
        <h1>Alış Defteri / Stok</h1>
        <div className="btn-group">
          <button
            className={`seg ${mode === 'purchase' ? 'active' : ''}`}
            onClick={() => setMode('purchase')}
          >
            Alış (yeni mal girişi)
          </button>
          <button
            className={`seg ${mode === 'pay_only' ? 'active' : ''}`}
            onClick={() => setMode('pay_only')}
          >
            Sadece Ödeme
          </button>
          <button
            className={`seg danger-seg ${mode === 'supplier_return' ? 'active' : ''}`}
            onClick={() => setMode('supplier_return')}
          >
            Tedarikçi İadesi (mal çıkışı)
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="grid2">
        {mode === 'pay_only' ? (
        <div className="panel">
          <h3>Sadece Ödeme</h3>
          <div className="form-col">
            <label className="form-field">
              Tedarikçi (zorunlu)
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Tedarikçi seçin…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {chosenBalance != null && (
                <span className={`bal ${chosenBalance > 0 ? 'debt' : 'ok'}`}>
                  Güncel borç: {formatKurus(chosenBalance)}
                </span>
              )}
            </label>
            <label className="form-field">
              Ödeme Tutarı (TL)
              <input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0,00" />
            </label>
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
            <label className="form-field">
              Not
              <input value={payNote} onChange={(e) => setPayNote(e.target.value)} />
            </label>
            <button className="btn primary complete-btn" onClick={doPay} disabled={busy || !isAdmin}>
              {isAdmin ? (busy ? 'İşleniyor…' : 'Ödemeyi Kaydet') : 'Yalnızca yönetici yapabilir'}
            </button>
          </div>
        </div>
        ) : (
        <div className="panel">
          <h3>
            {mode === 'purchase' ? 'Alış Kalemleri' : 'İade Kalemleri'}{' '}
            <span className="sum-tone out">{formatKurus(total)}</span>
          </h3>
          <ProductPicker onAdd={addLine} />
          <table className="table">
            <thead>
              <tr>
                <th>Ürün</th>
                <th>Miktar</th>
                <th>Birim</th>
                <th>Tutar</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredLines().map((l) => (
                <tr key={l.productId}>
                  <td>
                    {l.name}
                    <span className="mono muted block" style={{ fontSize: '0.7rem' }}>
                      {l.barcode}
                    </span>
                  </td>
                  <td>
                    <div className="qty-ctrl">
                      <button onClick={() => setQty(l.productId, l.qty - 1)}>−</button>
                      <input
                        type="number"
                        min={0}
                        value={String(l.qty)}
                        onChange={(e) => setQty(l.productId, parseFloat(e.target.value))}
                      />
                      <button onClick={() => setQty(l.productId, l.qty + 1)}>+</button>
                    </div>
                  </td>
                  <td>
                    <input
                      className="price-inp"
                      value={kurusToTl(l.unitCost)}
                      onChange={(e) => setCost(l.productId, e.target.value)}
                    />
                  </td>
                  <td>{formatKurus(lineTotal(l))}</td>
                  <td>
                    <button className="line-x" onClick={() => removeLine(l.productId)}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Ürün eklemedi.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="form-col">
            <label className="form-field">
              Tedarikçi {mode === 'supplier_return' && <b>(zorunlu)</b>}
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Tedarikçi yok</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {mode === 'purchase' && (
              <>
                <label className="form-field">
                  Peşin Ödeme (TL)
                  <input
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    placeholder="0,00 = tamamı borç"
                  />
                </label>
                {payKurus > 0 ? (
                  <div className="btn-group">
                    {(['cash', 'card', 'transfer'] as PaymentMethod[]).map((m) => (
                      <button
                        key={m}
                        className={`seg ${paymentMethod === m ? 'active' : ''}`}
                        onClick={() => setPaymentMethod(m)}
                      >
                        {paymentMethodLabel(m)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Ödeme girilmezse tutar tedarikçi borcuna yazılır (tedarikçi seçilmelidir).</p>
                )}
              </>
            )}
            <label className="form-field">
              Not
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {mode === 'purchase' && debtAmount > 0 && (
              <p>
                Ödenecek: <strong>{formatKurus(payKurus)}</strong> · Kalan (borç):{' '}
                <strong className="debt">{formatKurus(debtAmount)}</strong>
              </p>
            )}
            <button className="btn primary complete-btn" onClick={doComplete} disabled={busy || !isAdmin}>
              {isAdmin ? (busy ? 'İşleniyor…' : mode === 'purchase' ? 'Alışı Tamamla' : 'İadeyi Tamamla') : 'Yalnızca yönetici yapabilir'}
            </button>
          </div>
        </div>
        )}

        <div className="panel">
          {mode === 'pay_only' ? (
            <>
              <h3>Tedarikçi Ödemeleri</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>Tedarikçi</th>
                    <th>Tutar</th>
                    <th>Yöntem</th>
                    <th>Not</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>{formatDate(new Date(p.date + 'T00:00:00').getTime())}</td>
                      <td>{p.supplierName}</td>
                      <td className="debt">-{formatKurus(p.amount)}</td>
                      <td>{paymentMethodLabel(p.paymentMethod)}</td>
                      <td>{p.note ?? '—'}</td>
                    </tr>
                  ))}
                  {payments.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        Henüz ödeme yok.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          ) : (
            <>
          <h3>Alış Geçmişi</h3>
          <table className="table">
            <thead>
              <tr>
                <th>No</th>
                <th>Tarih</th>
                <th>Tedarikçi</th>
                <th>Tip</th>
                <th>Tutar</th>
                <th>Ödenen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {history.map((p) => (
                <tr key={p.id} className={selected?.purchase.id === p.id ? 'row-active' : ''}>
                  <td>{p.purchaseNo}</td>
                  <td>{formatDate(new Date(p.purchaseDate + 'T00:00:00').getTime())}</td>
                  <td>{p.supplierName ?? '—'}</td>
                  <td>{kindLabel(p.kind)}</td>
                  <td className={p.total < 0 ? 'credit' : ''}>{formatKurus(p.total)}</td>
                  <td>{formatKurus(p.paidAmount)}</td>
                  <td>
                    <div className="row-actions">
                      <button onClick={() => openDetail(p)}>İncele</button>
                      {isAdmin && p.kind === 'purchase' && (
                        <button onClick={() => startEdit(p)}>Düzenle</button>
                      )}
                      {isAdmin && (
                        <button className="danger" onClick={() => removePurchase(p)}>
                          Sil
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    Alış kaydı yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
            </>
          )}
        </div>
      </div>

      {selected && (
        <Modal onClose={() => setSelected(null)} title={selected.purchase.purchaseNo}>
          <dl className="kv">
            <div>
              <dt>Tedarikçi</dt>
              <dd>{selected.purchase.supplierName ?? '—'}</dd>
            </div>
            <div>
              <dt>Tip</dt>
              <dd>{kindLabel(selected.purchase.kind)}</dd>
            </div>
            <div>
              <dt>Toplam</dt>
              <dd>{formatKurus(selected.purchase.total)}</dd>
            </div>
            <div>
              <dt>Ödenen</dt>
              <dd>{formatKurus(selected.purchase.paidAmount)}</dd>
            </div>
            <div>
              <dt>Kalan (borç)</dt>
              <dd>{formatKurus(selected.purchase.debtAmount)}</dd>
            </div>
          </dl>
          <table className="table">
            <thead>
              <tr>
                <th>Ürün</th>
                <th>Miktar</th>
                <th>Birim</th>
                <th>Tutar</th>
              </tr>
            </thead>
            <tbody>
              {selected.items.map((it) => (
                <tr key={it.productId}>
                  <td>{it.name}</td>
                  <td>{formatQty(it.quantity)}</td>
                  <td>{formatKurus(it.unitCost)}</td>
                  <td>{formatKurus(it.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

      {editTarget && (
        <Modal onClose={() => setEditTarget(null)} title={`Düzenle: ${editTarget.purchase.purchaseNo}`}>
          <p className="muted">
            Kaydedince eski stok etkisi geri alınır, yenisi uygulanır. Toplam, yapılan ödemeden
            küçük olamaz.
          </p>
          <ProductPicker onAdd={editAddLine} />
          <table className="table">
            <thead>
              <tr>
                <th>Ürün</th>
                <th>Miktar</th>
                <th>Birim</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {editItems.map((l) => (
                <tr key={l.productId}>
                  <td>{l.name}</td>
                  <td>
                    <div className="qty-ctrl">
                      <button onClick={() => editSetQty(l.productId, l.qty - 1)}>−</button>
                      <input
                        type="number"
                        min={0}
                        value={String(l.qty)}
                        onChange={(e) => editSetQty(l.productId, parseFloat(e.target.value))}
                      />
                      <button onClick={() => editSetQty(l.productId, l.qty + 1)}>+</button>
                    </div>
                  </td>
                  <td>
                    <input
                      className="price-inp"
                      value={kurusToTl(l.unitCost)}
                      onChange={(e) => editSetCost(l.productId, e.target.value)}
                    />
                  </td>
                  <td>
                    <button className="line-x" onClick={() => editRemoveLine(l.productId)}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn primary full" onClick={saveEdit} disabled={busy}>
            Kaydet
          </button>
        </Modal>
      )}
    </div>
  )
}

function ProductPicker({ onAdd }: { onAdd: (p: Product) => void }): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  useEffect(() => {
    void window.api
      .productsList({ activeOnly: true, search: search || undefined })
      .then(setProducts)
      .catch(() => setProducts([]))
  }, [search])

  return (
    <div>
      <input
        className="input"
        placeholder="Ürün ara… (alış fiyatı otomatik gelir)"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {search.trim() !== '' && (
        <div className="ppick">
          {products.map((p) => (
            <button key={p.id} className="ppick-item" onClick={() => onAdd(p)}>
              <span>{p.name}</span>
              <span>
                alış {formatKurus(p.purchasePrice)} · stok {p.stockQty}
              </span>
            </button>
          ))}
          {products.length === 0 && <p className="muted">Sonuç yok.</p>}
        </div>
      )}
    </div>
  )
}