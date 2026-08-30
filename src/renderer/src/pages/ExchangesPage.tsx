import React, { useEffect, useMemo, useState } from 'react'
import type {
  CustomerWithBalance,
  ExchangeDirection,
  ExchangeSettlement,
  ExchangeSummary,
  Product,
  SaleForReturn,
  SaleSummary
} from '@shared/types'
import {
  formatKurus,
  formatDateTime,
  kurusToTl,
  tlToKurus,
  paymentMethodLabel
} from '../utils/format'
import { useDataVersion } from '../context/DataContext'

interface ExLine {
  productId: number
  name: string
  barcode: string
  qty: number
  unitPrice: number
  direction: ExchangeDirection
}

function lineTotal(l: ExLine): number {
  return Math.round(l.unitPrice * l.qty)
}

function settlementLabel(s: ExchangeSettlement): string {
  switch (s) {
    case 'none':
      return 'Fark yok'
    case 'debt':
      return 'Borca'
    default:
      return paymentMethodLabel(s)
  }
}

export default function ExchangesPage(): React.JSX.Element {
  const dataVer = useDataVersion()
  const [inLines, setInLines] = useState<ExLine[]>([])
  const [outLines, setOutLines] = useState<ExLine[]>([])
  const [inLimits, setInLimits] = useState<Record<number, number>>({})
  const [originalSaleId, setOriginalSaleId] = useState<number | null>(null)
  const [receiptInput, setReceiptInput] = useState('')
  const [receiptBusy, setReceiptBusy] = useState(false)
  const [customers, setCustomers] = useState<CustomerWithBalance[]>([])
  const [customerId, setCustomerId] = useState('')
  const [settlement, setSettlement] = useState<ExchangeSettlement>('none')
  const [note, setNote] = useState('')
  const [history, setHistory] = useState<ExchangeSummary[]>([])
  const [sales, setSales] = useState<SaleSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => {
    const [custList, exList, saleList] = await Promise.all([
      window.api.customersWithBalance(),
      window.api.exchangesList(),
      window.api.returnsSales()
    ])
    setCustomers(custList)
    setHistory(exList)
    setSales(saleList)
  }

  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [dataVer, load])

  const totalIn = useMemo(() => inLines.reduce((s, l) => s + lineTotal(l), 0), [inLines])
  const totalOut = useMemo(() => outLines.reduce((s, l) => s + lineTotal(l), 0), [outLines])
  const difference = totalOut - totalIn

  function upsert(lines: ExLine[], direction: ExchangeDirection, p: Product): ExLine[] {
    const found = lines.find((l) => l.productId === p.id)
    if (found) {
      return lines.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l))
    }
    return [...lines, { productId: p.id, name: p.name, barcode: p.barcode, qty: 1, unitPrice: p.salePrice, direction }]
  }

  function addIn(p: Product): void {
    setInLines((prev) => upsert(prev, 'in', p))
  }

  function addOut(p: Product): void {
    setOutLines((prev) => upsert(prev, 'out', p))
  }

  function setQty(direction: ExchangeDirection, productId: number, qty: number): void {
    const upd = (lines: ExLine[]) =>
      lines.map((l) => {
        if (l.productId !== productId) return l
        let q = Math.round(qty)
        if (!Number.isFinite(q) || q < 0) q = 0
        if (direction === 'in' && inLimits[productId] != null) {
          q = Math.min(q, inLimits[productId])
        }
        return { ...l, qty: q }
      })
    if (direction === 'in') setInLines(upd)
    else setOutLines(upd)
  }

  function setPrice(direction: ExchangeDirection, productId: number, tl: string): void {
    const upd = (lines: ExLine[]) =>
      lines.map((l) =>
        l.productId === productId ? { ...l, unitPrice: tlToKurus(tl) } : l
      )
    if (direction === 'in') setInLines(upd)
    else setOutLines(upd)
  }

  function removeLine(direction: ExchangeDirection, productId: number): void {
    if (direction === 'in') setInLines((prev) => prev.filter((l) => l.productId !== productId))
    else setOutLines((prev) => prev.filter((l) => l.productId !== productId))
  }

  const effectiveSettlement: ExchangeSettlement =
    difference === 0 ? 'none' : settlement

  function applyReceipt(sr: SaleForReturn): void {
    setOriginalSaleId(sr.sale.id)
    const limits: Record<number, number> = {}
    for (const it of sr.items) {
      if (it.remainingQty > 0) limits[it.productId] = it.remainingQty
    }
    setInLimits(limits)
    setInLines(
      sr.items
        .filter((i) => i.remainingQty > 0)
        .map((i) => ({
          productId: i.productId,
          name: i.name,
          barcode: i.barcode,
          qty: 0,
          unitPrice: i.unitPrice,
          direction: 'in' as const
        }))
    )
    if (sr.sale.customerName) {
      const c = customers.find((x) => x.name === sr.sale.customerName)
      if (c) setCustomerId(String(c.id))
    }
  }

  function searchByReceipt(): void {
    setError(null)
    if (!receiptInput.trim()) return
    setReceiptBusy(true)
    void window.api
      .salesFindByReceipt(receiptInput)
      .then((sr) => {
        if (!sr) {
          setError('Fiş bulunamadı')
          return
        }
        applyReceipt(sr)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setReceiptBusy(false))
  }

  function loadBySale(sale: SaleSummary): void {
    setReceiptInput(sale.receiptNo)
    setError(null)
    setReceiptBusy(true)
    void window.api
      .salesFindByReceipt(sale.receiptNo)
      .then((sr) => {
        if (!sr) {
          setError('Fiş bulunamadı')
          return
        }
        applyReceipt(sr)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setReceiptBusy(false))
  }

  function clearReceipt(): void {
    setOriginalSaleId(null)
    setInLimits({})
    setReceiptInput('')
  }

  function complete(): void {
    setError(null)
    if (!inLines.length || !outLines.length) {
      setError('En az bir gelen ve bir giden ürün gerekir')
      return
    }
    if (
      (totalIn <= 0 || totalOut <= 0) &&
      (inLines.some((l) => l.qty <= 0) || outLines.some((l) => l.qty <= 0))
    ) {
      setError('Tüm kalemler için miktar girin')
      return
    }
    if (difference !== 0 && effectiveSettlement === 'none') {
      setError('Fark için ödeme şekli seçmelisiniz (nakit/kart/havale/borca)')
      return
    }
    if (effectiveSettlement === 'debt' && !customerId) {
      setError('Borca yansıtmak için müşteri seçmeniz gerekir')
      return
    }
    const items: Array<{
      productId: number
      quantity: number
      unitPrice: number
      direction: ExchangeDirection
    }> = [
      ...inLines.filter((l) => l.qty > 0).map((l) => ({ productId: l.productId, quantity: l.qty, unitPrice: l.unitPrice, direction: 'in' as const })),
      ...outLines.filter((l) => l.qty > 0).map((l) => ({ productId: l.productId, quantity: l.qty, unitPrice: l.unitPrice, direction: 'out' as const }))
    ]
    setBusy(true)
    void window.api
      .exchangesComplete({
        customerId: customerId ? Number(customerId) : null,
        originalSaleId,
        items,
        differenceSettlement: effectiveSettlement,
        note: note || undefined
      })
      .then((res) => {
        if (!res.ok) {
          setError(res.error ?? 'Değişim tamamlanamadı')
          return
        }
        setInLines([])
        setOutLines([])
        clearReceipt()
        setCustomerId('')
        setSettlement('none')
        setNote('')
        return load()
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Değişim</h1>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="panel">
        <h3>
          Fişten Yükle{' '}
          {originalSaleId != null && (
            <span className="muted" style={{ fontSize: '0.75rem' }}>
              (satışa bağlı değişim — iade limitleri fişten gelir)
            </span>
          )}
        </h3>
        <div className="receipt-search">
          <input
            className="input"
            placeholder="Fiş seri no (F-…); iade edilen ürünler gelen satıra yüklenir"
            value={receiptInput}
            onChange={(e) => setReceiptInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') searchByReceipt()
            }}
          />
          <button className="btn" onClick={searchByReceipt} disabled={receiptBusy || !receiptInput.trim()}>
            {receiptBusy ? '…' : 'Yükle'}
          </button>
          {originalSaleId != null && (
            <button className="btn" onClick={clearReceipt}>
              Fişten Bağımsızla
            </button>
          )}
        </div>
        {sales.length > 0 && (
          <div className="sale-list">
            <span className="muted" style={{ fontSize: '0.75rem' }}>
              Son fişler — tıklayınca ürünler gelen satıra yüklenir:
            </span>
            <div className="sale-list-items">
              {sales.slice(0, 8).map((s) => (
                <button
                  key={s.id}
                  className={`sale-chip ${originalSaleId === s.id ? 'active' : ''}`}
                  onClick={() => loadBySale(s)}
                  disabled={receiptBusy}
                >
                  {s.receiptNo}
                  <span className="muted">
                    {formatDateTime(s.createdAt)} · {s.customerName ?? 'Anonim'} ·{' '}
                    {formatKurus(s.total)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {originalSaleId != null && (
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            İade edilecek (gelen) kalemler bu fişin kalan miktarıyla sınırlanır. Bağlama zorunlu değil —
            fişsiz de değişim yapabilirsiniz.
          </p>
        )}
      </div>

      <div className="grid2">
        <LinePanel
          title="Gelen Ürün (iade edilen / teslim alınan)"
          lines={inLines}
          total={totalIn}
          tone="in"
          placeholder="Ürün ara…"
          onAdd={addIn}
          onSetQty={(id, q) => setQty('in', id, q)}
          onSetPrice={(id, tl) => setPrice('in', id, tl)}
          onRemove={(id) => removeLine('in', id)}
        />
        <LinePanel
          title="Giden Ürün (yeni verilen)"
          lines={outLines}
          total={totalOut}
          tone="out"
          placeholder="Ürün ara…"
          onAdd={addOut}
          onSetQty={(id, q) => setQty('out', id, q)}
          onSetPrice={(id, tl) => setPrice('out', id, tl)}
          onRemove={(id) => removeLine('out', id)}
        />
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>Fark ve Ödeme</h3>
          <dl className="kv">
            <div>
              <dt>Gelen Toplam</dt>
              <dd>{formatKurus(totalIn)}</dd>
            </div>
            <div>
              <dt>Giden Toplam</dt>
              <dd>{formatKurus(totalOut)}</dd>
            </div>
            <div>
              <dt className="strong">Fark</dt>
              <dd className={`strong ${difference >= 0 ? 'debt' : 'credit'}`}>
                {difference > 0 ? '+' : difference < 0 ? '−' : ''}
                {formatKurus(Math.abs(difference))}
              </dd>
            </div>
          </dl>
          <p className="muted">
            {difference > 0
              ? 'Müşteri farkı öder.'
              : difference < 0
                ? 'Size ait fark müşteriye iade edilir.'
                : 'Fark yok.'}
          </p>
          <div className="form-col">
            {difference !== 0 && (
              <label className="form-field">
                Fark Nasıl Çözülsün?
                <select
                  value={settlement}
                  onChange={(e) => setSettlement(e.target.value as ExchangeSettlement)}
                >
                  <option value="">Seçin…</option>
                  <option value="cash">{difference > 0 ? 'Ödenir: ' : 'İade: '}Nakit</option>
                  <option value="card">{difference > 0 ? 'Ödenir: ' : 'İade: '}Kart</option>
                  <option value="transfer">{difference > 0 ? 'Ödenir: ' : 'İade: '}Havale</option>
                  <option value="debt">
                    {difference > 0 ? 'Borca yaz' : 'Borçtan düş'}
                  </option>
                </select>
              </label>
            )}
            <label className="form-field">
              Müşteri (borç için zorunlu)
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Müşteri yok</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {formatKurus(c.balance)}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Not
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button
              className="btn primary complete-btn"
              onClick={complete}
              disabled={busy || !inLines.length || !outLines.length}
            >
              {busy ? 'İşleniyor…' : 'Değişimi Tamamla'}
            </button>
          </div>
        </div>

        <div className="panel">
          <h3>Değişim Geçmişi</h3>
          <table className="table">
            <thead>
              <tr>
                <th>No</th>
                <th>Tarih</th>
                <th>Müşteri</th>
                <th>Gelen</th>
                <th>Giden</th>
                <th>Fark</th>
                <th>Çözüm</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>
                    {h.exchangeNo}
                    {h.originalReceiptNo && (
                      <span className="muted block" style={{ fontSize: '0.7rem' }}>
                        {h.originalReceiptNo}
                      </span>
                    )}
                  </td>
                  <td>{formatDateTime(h.createdAt)}</td>
                  <td>{h.customerName ?? '—'}</td>
                  <td>{formatKurus(h.totalIn)}</td>
                  <td>{formatKurus(h.totalOut)}</td>
                  <td className={h.difference >= 0 ? 'debt' : 'credit'}>
                    {h.difference > 0 ? '+' : h.difference < 0 ? '−' : ''}
                    {formatKurus(Math.abs(h.difference))}
                  </td>
                  <td>{settlementLabel(h.differenceSettlement)}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    Henüz değişim yok.
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

function LinePanel({
  title,
  lines,
  total,
  tone,
  placeholder,
  onAdd,
  onSetQty,
  onSetPrice,
  onRemove
}: {
  title: string
  lines: ExLine[]
  total: number
  tone: 'in' | 'out'
  placeholder: string
  onAdd: (p: Product) => void
  onSetQty: (productId: number, qty: number) => void
  onSetPrice: (productId: number, tl: string) => void
  onRemove: (productId: number) => void
}): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  useEffect(() => {
    void window.api
      .productsList({ activeOnly: true, search: search || undefined })
      .then(setProducts)
      .catch(() => setProducts([]))
  }, [search])

  return (
    <div className="panel">
      <h3>
        {title} <span className={`sum-tone ${tone}`}>{formatKurus(total)}</span>
      </h3>
      <input
        className="input"
        placeholder={placeholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {search.trim() !== '' && (
        <div className="ppick">
          {products.map((p) => (
            <button key={p.id} className="ppick-item" onClick={() => onAdd(p)}>
              <span>{p.name}</span>
              <span>
                {formatKurus(p.salePrice)} · stok {p.stockQty}
              </span>
            </button>
          ))}
          {products.length === 0 && <p className="muted">Sonuç yok.</p>}
        </div>
      )}
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
                <span className="mono muted block" style={{ fontSize: '0.7rem' }}>
                  {l.barcode}
                </span>
              </td>
              <td>
                <div className="qty-ctrl">
                  <button onClick={() => onSetQty(l.productId, l.qty - 1)}>−</button>
                  <input
                    type="number"
                    min={0}
                    value={String(l.qty)}
                    onChange={(e) => onSetQty(l.productId, parseFloat(e.target.value))}
                  />
                  <button onClick={() => onSetQty(l.productId, l.qty + 1)}>+</button>
                </div>
              </td>
              <td>
                <input
                  className="price-inp"
                  value={kurusToTl(l.unitPrice)}
                  onChange={(e) => onSetPrice(l.productId, e.target.value)}
                />
              </td>
              <td>{formatKurus(lineTotal(l))}</td>
              <td>
                <button className="line-x" onClick={() => onRemove(l.productId)}>
                  ×
                </button>
              </td>
            </tr>
          ))}
          {lines.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                Ürün eklenmedi.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}