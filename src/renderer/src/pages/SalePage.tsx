import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Category, CartLine, Customer, Hold, PaymentMethod, Product, SaleReceipt } from '@shared/types'
import Modal from '../components/Modal'
import { useDataVersion } from '../context/DataContext'
import {
  formatKurus,
  formatDateTime,
  kurusToTl,
  tlToKurus,
  paymentMethodLabel
} from '../utils/format'

type LineDiscount = { pct: string }

interface LineExtra {
  discountPct: string
}

type CartEntry = CartLine & LineExtra

export default function SalePage({ userId }: { userId: number }): React.JSX.Element {
  const dataVer = useDataVersion()
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCat, setSelectedCat] = useState<number | 'all'>('all')
  const [gridSearch, setGridSearch] = useState('')
  const [barcode, setBarcode] = useState('')
  const [cart, setCart] = useState<CartEntry[]>([])
  const [customerId, setCustomerId] = useState('')
  const [customerBalance, setCustomerBalance] = useState<number | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [amountPaid, setAmountPaid] = useState('')
  const [totalDiscount, setTotalDiscount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null)
  const [holds, setHolds] = useState<Hold[]>([])
  const [showHolds, setShowHolds] = useState(false)
  const [heldId, setHeldId] = useState<number | null>(null)
  const [newCust, setNewCust] = useState(false)
  const [newCustName, setNewCustName] = useState('')
  const [newCustPhone, setNewCustPhone] = useState('')
  const barcodeRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    const [productList, catList, custList, holdList] = await Promise.all([
      window.api.productsList({ activeOnly: true }),
      window.api.categoriesList(),
      window.api.customersList(),
      window.api.holdsList()
    ])
    setProducts(productList)
    setCategories(catList)
    setCustomers(custList)
    setHolds(holdList)
  }, [dataVer])

  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [load])

  useEffect(() => {
    if (customerId) {
      void window.api
        .customersBalance(Number(customerId))
        .then(setCustomerBalance)
        .catch(() => setCustomerBalance(null))
    } else {
      setCustomerBalance(null)
    }
  }, [customerId, dataVer])

  const subtotal = useMemo(
    () => cart.reduce((s, l) => s + l.lineTotal, 0),
    [cart]
  )
  const discountTotal = useMemo(() => tlToKurus(totalDiscount), [totalDiscount])
  const finalTotal = useMemo(
    () => Math.max(0, subtotal - Math.min(subtotal, discountTotal)),
    [subtotal, discountTotal]
  )
  const paid = useMemo(() => tlToKurus(amountPaid || kurusToTl(finalTotal)), [amountPaid, finalTotal])
  const openDebt = Math.max(0, finalTotal - paid)

  const filteredProducts = useMemo(() => {
    const q = gridSearch.trim().toLocaleLowerCase('tr')
    return products.filter((p) => {
      if (selectedCat !== 'all' && p.categoryId !== selectedCat) return false
      if (!q) return true
      return (
        p.name.toLocaleLowerCase('tr').includes(q) ||
        p.barcode.toLocaleLowerCase('tr').includes(q)
      )
    })
  }, [products, selectedCat, gridSearch])

  function makeLine(p: Product): CartEntry {
    const lineTotal = Math.round(p.salePrice)
    return {
      productId: p.id,
      name: p.name,
      barcode: p.barcode,
      quantity: 1,
      unitPrice: p.salePrice,
      discount: 0,
      lineTotal,
      stockQty: p.stockQty,
      discountPct: ''
    }
  }

  function addProduct(p: Product): void {
    setError(null)
    if (p.stockQty <= 0) {
      setError(`"${p.name}" stokta yok`)
      return
    }
    setCart((prev) => {
      const found = prev.find((l) => l.productId === p.id)
      if (found) {
        return prev.map((l) => {
          if (l.productId !== p.id) return l
          const qty = Math.min(p.stockQty, l.quantity + 1)
          return recompute(l, qty)
        })
      }
      return [...prev, makeLine(p)]
    })
  }

  function addByBarcode(raw: string): void {
    const code = raw.trim()
    setBarcode('')
    if (!code) return
    const found = products.find((p) => p.barcode === code)
    if (!found) {
      setError(`Barkod bulunamadı: ${code}`)
      return
    }
    addProduct(found)
  }

  function recompute(line: CartEntry, qty: number, price?: number): CartEntry {
    const unitPrice = price ?? line.unitPrice
    const lineSubtotal = Math.round(unitPrice * qty)
    const pct = Math.max(0, Math.min(100, parseFloat(line.discountPct) || 0))
    const discount = Math.min(lineSubtotal, Math.round((lineSubtotal * pct) / 100))
    return {
      ...line,
      quantity: qty,
      unitPrice,
      discount,
      lineTotal: lineSubtotal - discount
    }
  }

  function setQty(productId: number, qty: number): void {
    setCart((prev) =>
      prev.map((l) => {
        if (l.productId !== productId) return l
        const clamped = Math.max(1, Math.min(l.stockQty, Math.round(qty) || 1))
        return recompute(l, clamped)
      })
    )
  }

  function setPrice(productId: number, priceText: string): void {
    setCart((prev) =>
      prev.map((l) =>
        l.productId === productId ? recompute(l, l.quantity, tlToKurus(priceText)) : l
      )
    )
  }

  function setDiscountPct(productId: number, pct: string): void {
    setCart((prev) =>
      prev.map((l) => {
        if (l.productId !== productId) return l
        const next = { ...l, discountPct: pct }
        return recompute(next, next.quantity)
      })
    )
  }

  function removeLine(productId: number): void {
    setCart((prev) => prev.filter((l) => l.productId !== productId))
  }

  function toggleHoldPanel(): void {
    setShowHolds((s) => !s)
  }

  function holdCart(): void {
    if (!cart.length) {
      setError('Sepet boş, bekletilecek satış yok')
      return
    }
    setError(null)
    const customer = customers.find((c) => c.id === Number(customerId))
    void window.api
      .holdsCreate({
        customerName: customer?.name,
        itemsJson: JSON.stringify(cart),
        total: finalTotal
      })
      .then(() => {
        setCart([])
        setBarcode('')
        barcodeRef.current?.focus()
        return window.api.holdsList()
      })
      .then(setHolds)
      .catch((e) => setError(String(e)))
  }

  function restoreHold(hold: Hold): void {
    try {
      const items = JSON.parse(hold.itemsJson) as CartEntry[]
      if (cart.length && !window.confirm('Sepette zaten ürün var. Yine de yüklensin mi?')) return
      setCart(items)
      setShowHolds(false)
      setHeldId(hold.id)
      void window.api.holdsRemove(hold.id).then(() => window.api.holdsList().then(setHolds))
    } catch {
      setError('Bekletilen satış okunamadı')
    }
  }

  function createCustomer(): void {
    if (!newCustName.trim()) return
    setError(null)
    void window.api
      .customersCreate({ name: newCustName, phone: newCustPhone })
      .then((c) => {
        setCustomers((prev) => [...prev.filter((x) => x.id !== c.id), c].sort((a, b) => a.name.localeCompare(b.name, 'tr')))
        setCustomerId(String(c.id))
        setNewCust(false)
        setNewCustName('')
        setNewCustPhone('')
      })
      .catch((e) => setError(String(e)))
  }

  function complete(): void {
    if (!cart.length) {
      setError('Sepet boş')
      return
    }
    if (openDebt > 0 && !customerId) {
      setError('Ödeme eksik! Borç ile satış için müşteri seçmelisiniz.')
      return
    }
    setBusy(true)
    setError(null)
    const effectivePaid = Math.min(finalTotal, paid)
    void window.api
      .salesComplete({
        items: cart.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: l.discount
        })),
        customerId: customerId ? Number(customerId) : null,
        paymentMethod,
        amountPaid: effectivePaid,
        totalDiscount: discountTotal
      })
      .then((res) => {
        if (!res.ok) {
          setError(res.error ?? 'Satış tamamlanamadı')
          return
        }
        setReceipt(res.receipt ?? null)
        setCart([])
        setBarcode('')
        setAmountPaid('')
        setTotalDiscount('')
        setCustomerId('')
        if (heldId != null) {
          void window.api.holdsComplete(heldId)
          setHeldId(null)
        }
        return load()
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  function startNewSale(): void {
    setReceipt(null)
    barcodeRef.current?.focus()
  }

  const selectedCustomer = customers.find((c) => c.id === Number(customerId))

  return (
    <div className="pos">
      <div className="pos-cats">
        <button
          className={`cat-btn ${selectedCat === 'all' ? 'active' : ''}`}
          onClick={() => setSelectedCat('all')}
        >
          Tümü
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            className={`cat-btn ${selectedCat === c.id ? 'active' : ''}`}
            onClick={() => setSelectedCat(c.id)}
          >
            {c.name}
          </button>
        ))}
        <div className="cat-footer">
          <button className="btn small" onClick={toggleHoldPanel}>
            Bekletilenler ({holds.length})
          </button>
        </div>
      </div>

      <div className="pos-grid">
        <div className="pos-tools">
          <input
            className="input"
            placeholder="Ürün ara…"
            value={gridSearch}
            onChange={(e) => setGridSearch(e.target.value)}
          />
        </div>
        <div className="product-grid">
          {filteredProducts.map((p) => {
            const low = p.stockQty <= p.minStock
            const out = p.stockQty <= 0
            return (
              <button
                key={p.id}
                className={`prod-card ${out ? 'out' : ''}`}
                onClick={() => addProduct(p)}
                disabled={out}
              >
                <span className="prod-name">{p.name}</span>
                <span className="prod-price">{formatKurus(p.salePrice)}</span>
                <span className={`prod-stock ${low ? 'low' : ''}`}>
                  Stok: {p.stockQty}
                </span>
              </button>
            )
          })}
          {filteredProducts.length === 0 && (
            <p className="muted pos-empty">Bu kategoride ürün yok.</p>
          )}
        </div>
      </div>

      <div className="pos-cart">
        <div className="cart-head">
          <span>Sepet</span>
          <div className="cart-actions">
            <button className="btn small" onClick={holdCart}>
              Beklet
            </button>
            {cart.length > 0 && (
              <button className="btn small danger" onClick={() => setCart([])}>
                Boşalt
              </button>
            )}
          </div>
        </div>

        <div className="cart-barcode">
          <input
            ref={barcodeRef}
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addByBarcode(barcode)
            }}
            placeholder="Barkod oku → Enter"
            className="input mono"
          />
        </div>

        {showHolds && holds.length > 0 && (
          <div className="holds">
            {holds.map((h) => (
              <div key={h.id} className="holds-item">
                <span>
                  {formatDateTime(h.createdAt)} — {formatKurus(h.total)}
                  {h.customerName ? ` (${h.customerName})` : ''}
                </span>
                <button className="btn small" onClick={() => restoreHold(h)}>
                  Yükle
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="cart-lines">
          {cart.length === 0 && <p className="muted">Sepet boş</p>}
          {cart.map((l) => (
            <div key={l.productId} className="cart-line">
              <div className="line-top">
                <div className="line-name">
                  {l.name}
                  <span className="mono">{l.barcode}</span>
                </div>
                <button className="line-x" onClick={() => removeLine(l.productId)}>
                  ×
                </button>
              </div>
              <div className="line-controls">
                <div className="qty-ctrl">
                  <button onClick={() => setQty(l.productId, l.quantity - 1)}>−</button>
                  <input
                    value={String(l.quantity)}
                    onChange={(e) => setQty(l.productId, parseFloat(e.target.value))}
                    type="number"
                    min={1}
                    max={l.stockQty}
                  />
                  <button onClick={() => setQty(l.productId, l.quantity + 1)}>+</button>
                </div>
                <input
                  className="price-inp"
                  value={kurusToTl(l.unitPrice)}
                  onChange={(e) => setPrice(l.productId, e.target.value)}
                  title="Birim fiyat"
                />
                <input
                  className="dsc-inp"
                  value={l.discountPct}
                  onChange={(e) => setDiscountPct(l.productId, e.target.value)}
                  placeholder="İnd. %"
                  title="Satır indirimi (%)"
                />
                <span className="line-total">{formatKurus(l.lineTotal)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="cart-summary">
          <div className="sum-row">
            <span>Ara Toplam</span>
            <span>{formatKurus(subtotal)}</span>
          </div>
          <div className="sum-row">
            <span>Toplam İndirim</span>
            <input
              className="sum-inp"
              value={totalDiscount}
              onChange={(e) => setTotalDiscount(e.target.value)}
              placeholder="0,00"
            />
          </div>
          <div className="sum-row total">
            <span>Toplam</span>
            <span>{formatKurus(finalTotal)}</span>
          </div>
        </div>

        <div className="pay-section">
          <label className="form-field">
            Müşteri
            <div className="cust-row">
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">🧍 Anonim müşteri</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button className="btn small" onClick={() => setNewCust(true)}>
                + Müşteri
              </button>
            </div>
            {customerBalance != null && (
              <span className={`bal ${customerBalance > 0 ? 'debt' : 'ok'}`}>
                Mevcut borç: {formatKurus(customerBalance)}
              </span>
            )}
          </label>

          <div className="pay-methods">
            {(['cash', 'card', 'transfer'] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                className={`pay-btn ${paymentMethod === m ? 'active' : ''}`}
                onClick={() => setPaymentMethod(m)}
              >
                {paymentMethodLabel(m)}
              </button>
            ))}
          </div>

          <label className="form-field">
            Alınan
            <input
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
              placeholder={kurusToTl(finalTotal)}
            />
          </label>

          {openDebt > 0 && selectedCustomer && (
            <div className="debt-note">
              Kalan <strong>{formatKurus(openDebt)}</strong>{' '}
              <em>{selectedCustomer.name}</em> borcuna işlenecek.
            </div>
          )}
          {openDebt > 0 && !selectedCustomer && (
            <div className="debt-note warn">
              Ödeme eksik! Borç ile satış için müşteri seçmeniz gerekir.
            </div>
          )}

          {error && <p className="error">{error}</p>}

          <button
            className="btn primary complete-btn"
            onClick={complete}
            disabled={busy || cart.length === 0}
          >
            {busy ? 'İşleniyor…' : 'Satışı Tamamla'}
          </button>
        </div>
      </div>

      {newCust && (
        <Modal title="Yeni Müşteri" onClose={() => setNewCust(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              createCustomer()
            }}
          >
            <label className="form-field">
              Ad Soyad
              <input
                value={newCustName}
                onChange={(e) => setNewCustName(e.target.value)}
                autoFocus
              />
            </label>
            <label className="form-field">
              Telefon (opsiyonel)
              <input
                value={newCustPhone}
                onChange={(e) => setNewCustPhone(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setNewCust(false)}>
                Vazgeç
              </button>
              <button type="submit" className="btn primary" disabled={!newCustName.trim()}>
                Kaydet
              </button>
            </div>
          </form>
        </Modal>
      )}

      {receipt && <ReceiptModal receipt={receipt} onClose={startNewSale} />}
    </div>
  )
}

function ReceiptModal({
  receipt,
  onClose
}: {
  receipt: SaleReceipt
  onClose: () => void
}): React.JSX.Element {
  return (
    <Modal title="Fiş Önizleme" onClose={onClose}>
      <div className="receipt">
        <header>
          <h2>Yazar Kasa</h2>
          <p>Fiş No: {receipt.receiptNo}</p>
          <p>{formatDateTime(receipt.createdAt)}</p>
          {receipt.customerName && <p>Müşteri: {receipt.customerName}</p>}
        </header>
        <div className="r-line head">
          <span>Ürün</span>
          <span>Tutar</span>
        </div>
        {receipt.items.map((it) => (
          <div className="r-line" key={it.productId + it.name}>
            <span>
              {it.name}
              <br />
              <small>
                {it.quantity} × {formatKurus(it.unitPrice)}
                {it.discount > 0 ? ` (İnd. ${formatKurus(it.discount)})` : ''}
              </small>
            </span>
            <span>{formatKurus(it.lineTotal)}</span>
          </div>
        ))}
        <div className="r-tot">
          <div className="r-line">
            <span>Ara Toplam</span>
            <span>{formatKurus(receipt.subtotal)}</span>
          </div>
          {receipt.discountTotal > 0 && (
            <div className="r-line">
              <span>İndirim</span>
              <span>−{formatKurus(receipt.discountTotal)}</span>
            </div>
          )}
          <div className="r-line strong">
            <span>TOPLAM</span>
            <span>{formatKurus(receipt.total)}</span>
          </div>
          <div className="r-line">
            <span>Ödenen ({paymentMethodLabel(receipt.paymentMethod)})</span>
            <span>{formatKurus(receipt.paidAmount)}</span>
          </div>
          {receipt.debtAmount > 0 && (
            <div className="r-line debt">
              <span>Kalan Borç</span>
              <span>{formatKurus(receipt.debtAmount)}</span>
            </div>
          )}
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={() => window.print()}>
          Yazdır
        </button>
        <button className="btn primary" onClick={onClose}>
          Yeni Satış
        </button>
      </div>
    </Modal>
  )
}