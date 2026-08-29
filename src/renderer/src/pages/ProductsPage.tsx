import { useCallback, useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import type { Category, Product, ProductInput } from '@shared/types'
import { generateEan13, isEan13 } from '@shared/barcode'
import Modal from '../components/Modal'
import { useDataVersion } from '../context/DataContext'
import { formatKurus, kurusToTl, tlToKurus, formatQty } from '../utils/format'

function BarcodeSvg({
  value,
  height = 46,
  width = 1.4
}: {
  value: string
  height?: number
  width?: number
}): React.JSX.Element {
  const ref = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = ''
    if (!value) return
    try {
      JsBarcode(el, value, {
        format: isEan13(value) ? 'EAN13' : 'CODE128',
        height,
        width,
        displayValue: false,
        margin: 0
      })
    } catch (err) {
      console.warn('Barkod çizilemedi:', err)
    }
  }, [value, height, width])

  return <svg ref={ref} className="barcode-svg" />
}

interface FormState {
  name: string
  barcode: string
  categoryId: string
  purchasePrice: string
  salePrice: string
  stockQty: string
  minStock: string
  note: string
  isActive: boolean
}

const EMPTY_FORM: FormState = {
  name: '',
  barcode: '',
  categoryId: '',
  purchasePrice: '',
  salePrice: '',
  stockQty: '',
  minStock: '',
  note: '',
  isActive: true
}

type ModalState = null | { mode: 'create' } | { mode: 'edit'; product: Product }

export default function ProductsPage(): React.JSX.Element {
  const dataVer = useDataVersion()
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [modal, setModal] = useState<ModalState>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [productList, catList] = await Promise.all([
        window.api.productsList({
          search,
          categoryId: catFilter ? Number(catFilter) : null
        }),
        window.api.categoriesList()
      ])
      setProducts(productList)
      setCategories(catList)
    } catch (e) {
      setError(String(e))
    }
  }, [search, catFilter, dataVer])

  useEffect(() => {
    void load()
  }, [load])

  function openCreate(): void {
    setForm(EMPTY_FORM)
    setModal({ mode: 'create' })
  }

  function openEdit(product: Product): void {
    setForm({
      name: product.name,
      barcode: product.barcode,
      categoryId: product.categoryId ? String(product.categoryId) : '',
      purchasePrice: kurusToTl(product.purchasePrice),
      salePrice: kurusToTl(product.salePrice),
      stockQty: String(product.stockQty),
      minStock: String(product.minStock),
      note: product.note ?? '',
      isActive: product.isActive
    })
    setModal({ mode: 'edit', product })
  }

  function autoBarcode(): void {
    setForm((f) => ({ ...f, barcode: generateEan13() }))
  }

  function buildInput(): ProductInput {
    return {
      barcode: form.barcode.trim(),
      name: form.name,
      categoryId: form.categoryId ? Number(form.categoryId) : null,
      purchasePrice: tlToKurus(form.purchasePrice),
      salePrice: tlToKurus(form.salePrice),
      stockQty: Math.max(0, parseFloat(form.stockQty) || 0),
      minStock: Math.max(0, parseFloat(form.minStock) || 0),
      note: form.note,
      isActive: form.isActive
    }
  }

  async function save(): Promise<void> {
    if (!form.name.trim()) {
      setError('Ürün adı boş olamaz')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (modal?.mode === 'create') {
        await window.api.productsCreate(buildInput())
      } else if (modal?.mode === 'edit') {
        await window.api.productsUpdate(modal.product.id, buildInput())
      }
      setModal(null)
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(product: Product): Promise<void> {
    if (!window.confirm(`"${product.name}" ürünü silinsin mi?`)) return
    setError(null)
    try {
      await window.api.productsRemove(product.id)
      await load()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Ürünler</h1>
          <p className="muted">
            {products.length} ürün · Stok ve fiyat yönetimi
          </p>
        </div>
        <button className="btn primary" onClick={openCreate}>
          + Yeni Ürün
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="filters">
        <input
          className="input"
          placeholder="Ürün adı veya barkod ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input"
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
        >
          <option value="">Tüm kategoriler</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Ürün</th>
            <th>Barkod</th>
            <th>Kategori</th>
            <th className="num">Alış</th>
            <th className="num">Satış</th>
            <th className="num">Stok</th>
            <th className="th-actions">İşlem</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} className={p.isActive ? '' : 'row-inactive'}>
              <td>
                {p.name}
                {!p.isActive && <span className="tag muted-tag">pasif</span>}
                {p.stockQty <= p.minStock && <span className="tag warn-tag">az stok</span>}
              </td>
              <td className="mono">{p.barcode || '—'}</td>
              <td>{p.categoryName ?? '—'}</td>
              <td className="num">{formatKurus(p.purchasePrice)}</td>
              <td className="num">{formatKurus(p.salePrice)}</td>
              <td className="num">{formatQty(p.stockQty)}</td>
              <td className="td-actions">
                <button className="btn small" onClick={() => openEdit(p)}>
                  Düzenle
                </button>
                <button className="btn small danger" onClick={() => remove(p)}>
                  Sil
                </button>
              </td>
            </tr>
          ))}
          {products.length === 0 && (
            <tr>
              <td colSpan={7} className="empty">
                Ürün bulunamadı.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {modal && (
        <Modal
          title={modal.mode === 'create' ? 'Yeni Ürün' : 'Ürün Düzenle'}
          onClose={() => setModal(null)}
        >
          <form
            className="product-form"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <div className="form-grid-2">
              <label className="form-field">
                Ürün adı *
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  autoFocus
                />
              </label>
              <label className="form-field">
                Kategori
                <select
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                >
                  <option value="">— Kategori yok —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                Barkod
                <div className="barcode-row">
                  <input
                    value={form.barcode}
                    onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    placeholder="Okuyucu ile okutabilirsiniz"
                    className="mono"
                  />
                  <button type="button" className="btn small" onClick={autoBarcode}>
                    Otomatik
                  </button>
                </div>
              </label>

              <label className="form-field">
                Alış fiyatı (TL)
                <input
                  value={form.purchasePrice}
                  onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })}
                  placeholder="0,00"
                />
              </label>

              <label className="form-field">
                Satış fiyatı (TL)
                <input
                  value={form.salePrice}
                  onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
                  placeholder="0,00"
                />
              </label>

              <label className="form-field">
                Stok miktarı
                <input
                  value={form.stockQty}
                  onChange={(e) => setForm({ ...form, stockQty: e.target.value })}
                  type="number"
                  min={0}
                  step="any"
                />
              </label>

              <label className="form-field">
                Asgari stok (uyarı)
                <input
                  value={form.minStock}
                  onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                  type="number"
                  min={0}
                  step="any"
                />
              </label>

              <label className="form-field">
                Not
                <input
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </label>
            </div>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Ürün aktif (satışta görünür)
            </label>

            {form.barcode.trim() && (
              <div className="barcode-preview">
                <BarcodeSvg value={form.barcode.trim()} />
                <span className="mono">{form.barcode.trim()}</span>
              </div>
            )}

            <div className="label-preview">
              <div className="label-box">
                <div className="label-name">{form.name || 'Ürün adı'}</div>
                <BarcodeSvg value={form.barcode.trim()} height={34} width={1.2} />
                <div className="label-price">
                  {form.salePrice ? formatKurus(tlToKurus(form.salePrice)) : '—'}
                </div>
              </div>
              <span className="muted">Etiket önizlemesi</span>
              <button type="button" className="btn small" onClick={() => window.print()}>
                Etiketi Yazdır
              </button>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setModal(null)}>
                Vazgeç
              </button>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}