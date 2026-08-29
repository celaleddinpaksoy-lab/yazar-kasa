import { useCallback, useEffect, useState } from 'react'
import type { Category } from '@shared/types'
import Modal from '../components/Modal'
import { useDataVersion } from '../context/DataContext'

interface FormState {
  name: string
}

export default function CategoriesPage(): React.JSX.Element {
  const dataVer = useDataVersion()
  const [categories, setCategories] = useState<Category[]>([])
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<null | { mode: 'create' } | { mode: 'edit'; cat: Category }>(null)
  const [form, setForm] = useState<FormState>({ name: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setCategories(await window.api.categoriesList())
    } catch (e) {
      setError(String(e))
    }
  }, [dataVer])

  useEffect(() => {
    void load()
  }, [load])

  function openCreate(): void {
    setForm({ name: '' })
    setModal({ mode: 'create' })
  }

  function openEdit(cat: Category): void {
    setForm({ name: cat.name })
    setModal({ mode: 'edit', cat })
  }

  async function save(): Promise<void> {
    if (!form.name.trim()) {
      setError('Kategori adı boş olamaz')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (modal?.mode === 'create') {
        await window.api.categoriesCreate({ name: form.name })
      } else if (modal?.mode === 'edit') {
        await window.api.categoriesUpdate(modal.cat.id, {
          name: form.name,
          sortOrder: modal.cat.sortOrder
        })
      }
      setModal(null)
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(cat: Category): Promise<void> {
    if (!window.confirm(`"${cat.name}" kategorisi silinsin mi?`)) return
    setError(null)
    try {
      await window.api.categoriesRemove(cat.id)
      await load()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Kategoriler</h1>
          <p className="muted">Satış ekranındaki bölümler (Çocuk Giyim, Erkek Giyim…)</p>
        </div>
        <button className="btn primary" onClick={openCreate}>
          + Yeni Kategori
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {categories.length === 0 && !error && (
        <p className="muted">Henüz kategori yok. İlk kategorinizi ekleyin.</p>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Ad</th>
            <th>Sıra</th>
            <th className="th-actions">İşlem</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => (
            <tr key={cat.id}>
              <td>{cat.name}</td>
              <td>{cat.sortOrder}</td>
              <td className="td-actions">
                <button className="btn small" onClick={() => openEdit(cat)}>
                  Düzenle
                </button>
                <button className="btn small danger" onClick={() => remove(cat)}>
                  Sil
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal && (
        <Modal
          title={modal.mode === 'create' ? 'Yeni Kategori' : 'Kategori Düzenle'}
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <label className="form-field">
              Kategori adı
              <input
                value={form.name}
                onChange={(e) => setForm({ name: e.target.value })}
                autoFocus
              />
            </label>
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