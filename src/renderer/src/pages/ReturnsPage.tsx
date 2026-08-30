import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  CustomerWithBalance,
  PaymentMethod,
  Product,
  ReturnSummary,
  SaleForReturn,
  SaleSummary,
  User
} from '@shared/types'
import { useDataVersion } from '../context/DataContext'
import {
  formatKurus,
  formatDateTime,
  kurusToTl,
  tlToKurus,
  paymentMethodLabel
} from '../utils/format'

interface ReturnLine {
  productId: number
  name: string
  barcode: string
  qty: number
  unitPrice: number
  maxQty: number | null
}

function lineTotal(l: ReturnLine): number {
  return Math.round(l.unitPrice * l.qty)
}

function saleStatusLabel(s: string): string {
  switch (s) {
    case 'returned':
      return 'Tam iade'
    case 'partially_returned':
      return 'Kısmi iade'
    default:
      return 'Tamamlandı'
  }
}

function settlementLabel(m: ReturnSummary['settlementMethod']): string {
  switch (m) {
    case 'debt':
      return 'Borçtan düş'
    case 'cash_back':
      return 'Elden iade'
    case 'mixed':
      return 'Karışık'
  }
}

export default function ReturnsPage({ role }: { role: User['role'] }): React.JSX.Element {
  const dataVer = useDataVersion()
  const [mode, setMode] = useState<'sale' | 'standalone'>('sale')
  const [sales, setSales] = useState<SaleSummary[]>([])
  const [selectedSale, setSelectedSale] = useState<SaleForReturn | null>(null)
  const [lines, setLines] = useState<ReturnLine[]>([])
  const [customers, setCustomers] = useState<CustomerWithBalance[]>([])
  const [customerId, setCustomerId] = useState('')
  const [debtPart, setDebtPart] = useState('')
  const [cashPart, setCashPart] = useState('')
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash')
  const [note, setNote] = useState('')
  const [history, setHistory] = useState<ReturnSummary[]>([])
  const [search, setSearch] = useState('')
  const [receiptInput, setReceiptInput] = useState('')
  const [receiptBusy, setReceiptBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isPersonnel = role === 'personel'
  useEffect(() => {
    if (isPersonnel) setMode('sale')
  }, [isPersonnel])

  const load = useCallback(async () => {
    const [salesList, custList, returnList] = await Promise.all([
      window.api.returnsSales(),
      window.api.customersWithBalance(),
      window.api.returnsList()
    ])
    setSales(salesList)
    setCustomers(custList)
    setHistory(returnList)
  }, [dataVer])

  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [load])

  const total = useMemo(() => lines.reduce((s, l) => s + lineTotal(l), 0), [lines])

  const customer = customers.find((c) => c.id === Number(customerId))

  const debtEntered = debtPart.trim() !== ''
  const cashEntered = cashPart.trim() !== ''
  const debtParsed = debtEntered ? tlToKurus(debtPart) : 0
  const cashParsed = cashEntered ? tlToKurus(cashPart) : 0
  const eitherEntered = debtEntered || cashEntered
  const splitValid = !eitherEntered || debtParsed + cashParsed === total
  const effectiveDebt = eitherEntered
    ? debtParsed
    : customer && customer.balance > 0
      ? total
      : 0
  const effectiveCash = total - effectiveDebt

  function applySale(sr: SaleForReturn): void {
    setSelectedSale(sr)
    if (sr.sale.customerName) {
      const c = customers.find((x) => x.name === sr.sale.customerName)
      if (c) setCustomerId(String(c.id))
    }
    setLines(
      sr.items
        .filter((i) => i.remainingQty > 0)
        .map((i) => ({
          productId: i.productId,
          name: i.name,
          barcode: i.barcode,
          qty: 0,
          unitPrice: i.unitPrice,
          maxQty: i.remainingQty
        }))
    )
    setDebtPart('')
    setCashPart('')
  }

  function pickSale(saleId: number): void {
    setError(null)
    setResult(null)
    void window.api
      .returnsSaleReturnable(saleId)
      .then(applySale)
      .catch((e) => setError(String(e)))
  }

  function searchByReceipt(): void {
    setError(null)
    setResult(null)
    if (!receiptInput.trim()) return
    setReceiptBusy(true)
    void window.api
      .salesFindByReceipt(receiptInput)
      .then((sr) => {
        if (!sr) {
          setError('Fiş bulunamadı')
          return
        }
        setMode('sale')
        applySale(sr)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setReceiptBusy(false))
  }

  function selectAll(): void {
    setLines((prev) => prev.map((l) => ({ ...l, qty: l.maxQty ?? l.qty })))
  }

  function setQty(productId: number, qty: number): void {
    setLines((prev) =>
      prev.map((l) => {
        if (l.productId !== productId) return l
        const capped = l.maxQty != null ? Math.min(l.maxQty, Math.round(qty) || 0) : Math.round(qty) >= 0 ? Math.round(qty) : 0
        return { ...l, qty: capped }
      })
    )
  }

  function setPrice(productId: number, tl: string): void {
    setLines((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, unitPrice: tlToKurus(tl) } : l))
    )
  }

  function addStandalone(product: Product): void {
    setLines((prev) => {
      const found = prev.find((l) => l.productId === product.id)
      if (found) return prev.map((l) => (l.productId === product.id ? { ...l, qty: l.qty + 1 } : l))
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          barcode: product.barcode,
          qty: 1,
          unitPrice: product.salePrice,
          maxQty: null
        }
      ]
    })
  }

  function removeLine(productId: number): void {
    setLines((prev) => prev.filter((l) => l.productId !== productId))
  }

  function complete(): void {
    setError(null)
    setResult(null)
    if (!lines.length || total <= 0) {
      setError('İade edilecek ürün yok')
      return
    }
    if (eitherEntered && !splitValid) {
      setError('Borçtan düş + elden iade toplamı, iade tutarına eşit olmalı')
      return
    }
    if (effectiveDebt > 0 && !customerId) {
      setError('Borçtan düş için müşteri seçmeniz gerekir')
      return
    }
    const items =
      mode === 'sale' && selectedSale != null
        ? lines
            .filter((l) => l.qty > 0)
            .map((l) => ({ productId: l.productId, quantity: l.qty, unitPrice: l.unitPrice }))
        : lines.map((l) => ({
            productId: l.productId,
            quantity: l.qty,
            unitPrice: l.unitPrice
          }))

    setBusy(true)
    void window.api
      .returnsComplete({
        originalSaleId: mode === 'sale' ? (selectedSale?.sale.id ?? null) : null,
        customerId: customerId ? Number(customerId) : null,
        items,
        settlementDebt: effectiveDebt,
        settlementCashBack: effectiveCash,
        refundMethod: effectiveCash > 0 ? refundMethod : 'cash',
        note: note || undefined
      })
      .then((res) => {
        if (!res.ok) {
          setError(res.error ?? 'İade tamamlanamadı')
          return
        }
        setResult(`İade kaydı: ${res.returnNo} — tutar: ${formatKurus(res.total ?? 0)}`)
        setLines([])
        setDebtPart('')
        setCashPart('')
        setNote('')
        setCustomerId('')
        setSelectedSale(null)
        return load()
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>İade</h1>
      </header>

      {error && <p className="error">{error}</p>}
      {result && <p className="ok-banner">{result}</p>}

      <div className="mode-toggle">
        <button className={`btn ${mode === 'sale' ? 'primary' : ''}`} onClick={() => setMode('sale')}>
          Satıştan İade
        </button>
        {!isPersonnel && (
          <button
            className={`btn ${mode === 'standalone' ? 'primary' : ''}`}
            onClick={() => setMode('standalone')}
          >
            Sadece İade (fişsiz)
          </button>
        )}
      </div>

      <div className="grid2">
        <div className="panel">
          {mode === 'sale' ? (
            <>
              <h3>Satıştan İade — Fiş Seç</h3>
              <div className="receipt-search">
                <input
                  className="input"
                  placeholder="Fiş seri no (F-…); yazıp Ara…"
                  value={receiptInput}
                  onChange={(e) => setReceiptInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') searchByReceipt()
                  }}
                />
                <button className="btn" onClick={searchByReceipt} disabled={receiptBusy || !receiptInput.trim()}>
                  {receiptBusy ? '…' : 'Ara'}
                </button>
              </div>
              <div className="ret-sales">
                {sales.map((s) => (
                  <button
                    key={s.id}
                    className={`ret-sale ${selectedSale?.sale.id === s.id ? 'active' : ''}`}
                    onClick={() => pickSale(s.id)}
                  >
                    <span className="rs-top">
                      <strong>{s.receiptNo}</strong>
                      <span className={`badge ${s.status === 'completed' ? 'ok' : 'neutral'}`}>
                        {saleStatusLabel(s.status)}
                      </span>
                    </span>
                    <span className="rs-sub">
                      {formatDateTime(s.createdAt)} · {s.customerName ?? 'Anonim'} ·{' '}
                      {formatKurus(s.total)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <h3>Sadece İade — Ürün Ekle</h3>
              <input
                className="input"
                placeholder="Ürün ara…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="ret-sales">
                <ProductPicker search={search} onPick={addStandalone} />
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <h3>İade Kalemleri</h3>
          {selectedSale && mode === 'sale' && (
            <button className="btn small" onClick={selectAll}>
              Tümünü Seç
            </button>
          )}
          <p className="muted">
            Toplam İade: <strong>{formatKurus(total)}</strong>
          </p>
          {lines.length === 0 && <p className="muted">Henüz kalem yok.</p>}
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
              {lines.map((l) => (
                <tr key={l.productId}>
                  <td>
                    {l.name}
                    <span className="mono muted block">{l.barcode}</span>
                  </td>
                  <td>
                    <div className="qty-ctrl">
                      <button onClick={() => setQty(l.productId, l.qty - 1)}>−</button>
                      <input
                        type="number"
                        min={0}
                        max={l.maxQty ?? undefined}
                        value={String(l.qty)}
                        onChange={(e) => setQty(l.productId, parseFloat(e.target.value))}
                      />
                      <button onClick={() => setQty(l.productId, l.qty + 1)}>+</button>
                    </div>
                    {l.maxQty != null && (
                      <span className="muted" style={{ fontSize: '0.7rem' }}>
                        kalan {l.maxQty}
                      </span>
                    )}
                  </td>
                  <td>
                    <input
                      className="price-inp"
                      value={kurusToTl(l.unitPrice)}
                      onChange={(e) => setPrice(l.productId, e.target.value)}
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
                    —
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>Nasıl Yansıtılsın?</h3>
          <div className="form-col">
            <label className="form-field">
              Müşteri
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Anonim (müşteri yok)</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {formatKurus(c.balance)}
                  </option>
                ))}
              </select>
              {customer && customer.balance > 0 && (
                <span className="bal debt">Mevcut borç: {formatKurus(customer.balance)}</span>
              )}
            </label>
            <div className="split-row">
              <label className="form-field">
                Borçtan Düş (TL)
                <input value={debtPart} onChange={(e) => setDebtPart(e.target.value)} placeholder="0" />
              </label>
              <label className="form-field">
                Elden İade (TL)
                <input value={cashPart} onChange={(e) => setCashPart(e.target.value)} placeholder="0" />
              </label>
            </div>
            {eitherEntered && !splitValid && (
              <p className="error">Tutarlar iade toplamına (= {formatKurus(total)}) eşit olmalı.</p>
            )}
            {total > 0 && (
              <p className="muted">
                İşlecek: <strong>{formatKurus(effectiveDebt)}</strong> borçtan düş ·{' '}
                <strong>{formatKurus(effectiveCash)}</strong> elden iade
                {!eitherEntered ? ' (varsayılan seçim)' : ''}
              </p>
            )}
            {effectiveCash > 0 && (
              <label className="form-field">
                Ödeme Türü (elden iade)
                <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}>
                  {(['cash', 'card', 'transfer'] as PaymentMethod[]).map((m) => (
                    <option key={m} value={m}>
                      {paymentMethodLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="form-field">
              Not
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button
              className="btn primary complete-btn"
              onClick={complete}
              disabled={busy || !lines.length || total <= 0}
            >
              {busy ? 'İşleniyor…' : `İadeyi Tamamla (${formatKurus(total)})`}
            </button>
          </div>
        </div>

        <div className="panel">
          <h3>İade Geçmişi</h3>
          <table className="table">
            <thead>
              <tr>
                <th>No</th>
                <th>Tarih</th>
                <th>Müşteri</th>
                <th>Yansıma</th>
                <th>Tutar</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>
                    {h.returnNo}
                    {h.originalReceiptNo && (
                      <span className="muted block" style={{ fontSize: '0.7rem' }}>
                        {h.originalReceiptNo}
                      </span>
                    )}
                  </td>
                  <td>{formatDateTime(h.createdAt)}</td>
                  <td>{h.customerName ?? 'Anonim'}</td>
                  <td>{settlementLabel(h.settlementMethod)}</td>
                  <td className="credit">{formatKurus(-h.total)}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Henüz iade yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ProductPicker({
  search,
  onPick
}: {
  search: string
  onPick: (p: Product) => void
}): React.JSX.Element {
  const [products, setProducts] = useState<Product[]>([])
  useEffect(() => {
    void window.api
      .productsList({ activeOnly: true, search: search || undefined })
      .then(setProducts)
      .catch(() => setProducts([]))
  }, [search])
  if (search.trim() === '') {
    return <p className="muted">Ürün aramak için yukarıya yazın.</p>
  }
  if (products.length === 0) return <p className="muted">Sonuç yok.</p>
  return (
    <div className="ret-sales">
      {products.map((p) => (
        <button key={p.id} className="ret-sale" onClick={() => onPick(p)}>
          <span className="rs-top">
            <strong>{p.name}</strong>
            <span>{formatKurus(p.salePrice)}</span>
          </span>
          <span className="rs-sub">Stok: {p.stockQty}</span>
        </button>
      ))}
    </div>
  )
}