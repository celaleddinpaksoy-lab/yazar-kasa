import React, { useEffect, useState } from 'react'
import type { CashShiftSummary, User } from '@shared/types'
import CategoriesPage from '../pages/CategoriesPage'
import ProductsPage from '../pages/ProductsPage'
import SalePage from '../pages/SalePage'
import CashShiftPage from '../pages/CashShiftPage'
import CustomersPage from '../pages/CustomersPage'
import ReturnsPage from '../pages/ReturnsPage'
import ExchangesPage from '../pages/ExchangesPage'
import SuppliersPage from '../pages/SuppliersPage'
import PurchasesPage from '../pages/PurchasesPage'
import SettingsPage from '../pages/SettingsPage'
import DashboardPage from '../pages/DashboardPage'
import ReportsPage from '../pages/ReportsPage'
import DebtsPage from '../pages/DebtsPage'
import { DataContext } from '../context/DataContext'
import { tlToKurus } from '../utils/format'

interface Props {
  user: User
  onLogout: () => void
}

interface NavItem {
  key: string
  label: string
  ready: boolean
}

const NAV: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', ready: true },
  { key: 'sale', label: 'Satış (Kasa)', ready: true },
  { key: 'cash', label: 'Açılış/Kapanış', ready: true },
  { key: 'products', label: 'Ürünler', ready: true },
  { key: 'categories', label: 'Kategoriler', ready: true },
  { key: 'customers', label: 'Müşteriler & Borç', ready: true },
  { key: 'returns', label: 'İade', ready: true },
  { key: 'exchanges', label: 'Değişim', ready: true },
  { key: 'suppliers', label: 'Tedarikçiler', ready: true },
  { key: 'purchases', label: 'Alış Defteri / Stok', ready: true },
  { key: 'debts', label: 'Borç Defteri', ready: true },
  { key: 'reports', label: 'Raporlar', ready: true },
  { key: 'settings', label: 'Ayarlar', ready: true }
]

const PERSONNEL_KEYS = ['sale', 'cash', 'customers', 'returns', 'exchanges', 'settings']

function visibleNav(role: User['role']): NavItem[] {
  return role === 'admin' ? NAV : NAV.filter((n) => PERSONNEL_KEYS.includes(n.key))
}

function roleLabel(role: User['role']): string {
  return role === 'admin' ? 'Yönetici' : 'Personel'
}

export default function AppShell({ user, onLogout }: Props): React.JSX.Element {
  const defaultPage = user.role === 'admin' ? 'dashboard' : 'sale'
  const [page, setPage] = useState(defaultPage)
  const [dataVer, setDataVer] = useState(0)
  const [openShift, setOpenShift] = useState<CashShiftSummary | null | 'loading'>('loading')

  const visible = visibleNav(user.role)

  useEffect(() => {
    const off = window.api.onDataChanged((v) => setDataVer(v))
    return off
  }, [])

  useEffect(() => {
    window.api
      .cashGetOpen()
      .then(setOpenShift)
      .catch(() => setOpenShift(null))
  }, [dataVer])

  useEffect(() => {
    const handler = (e: Event): void => {
      const key = (e as CustomEvent<string>).detail
      if (visible.some((n) => n.key === key)) setPage(key)
    }
    window.addEventListener('nav:goto', handler)
    return () => window.removeEventListener('nav:goto', handler)
  }, [visible])

  useEffect(() => {
    if (!visible.some((n) => n.key === page)) setPage(defaultPage)
  }, [visible, page, defaultPage])

  const active = visible.find((n) => n.key === page) ?? visible[0]

  if (openShift === null) {
    return <CashOpenGate onOpened={() => setOpenShift(null)} />
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">Yazar Kasa</div>
        <nav className="nav">
          {visible.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${page === item.key ? 'active' : ''} ${item.ready ? '' : 'soon'}`}
              onClick={() => setPage(item.key)}
              title={item.ready ? item.label : `${item.label} (yakında)`}
            >
              {item.label}
              {!item.ready && <span className="badge">yakında</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-user">
          <div className="user-name">
            {user.name} <span className="role">{roleLabel(user.role)}</span>
          </div>
          <button className="logout-btn" onClick={onLogout}>
            Çıkış Yap
          </button>
        </div>
      </aside>

      <main className="content">
        <DataContext.Provider value={dataVer}>
          {page === 'dashboard' && <DashboardPage />}
          {page === 'sale' && <SalePage userId={user.id} />}
          {page === 'cash' && <CashShiftPage />}
          {page === 'customers' && <CustomersPage role={user.role} />}
          {page === 'returns' && <ReturnsPage role={user.role} />}
          {page === 'exchanges' && <ExchangesPage />}
          {page === 'products' && <ProductsPage />}
          {page === 'categories' && <CategoriesPage />}
          {page === 'suppliers' && <SuppliersPage role={user.role} />}
          {page === 'purchases' && <PurchasesPage role={user.role} />}
          {page === 'debts' && <DebtsPage />}
          {page === 'reports' && <ReportsPage />}
          {page === 'settings' && <SettingsPage role={user.role} />}

          {!visible.some((n) => n.key === page) && (
            <div className="page">
              <h1>{active.label}</h1>
              <p className="muted">Bu modül geliştirme aşamasında.</p>
            </div>
          )}
        </DataContext.Provider>
      </main>
    </div>
  )
}

/**
 * Açık kasa yoksa (cihazda tüm kullanıcılar için ortak tek vardiya)
 * işlem yapmayı engeller: satış/kasa açmadan uygulama kullanılamaz.
 * `cashOpen` mutatörü `broadcastDataChanged` yayınlayınca üst bileşen
 * kasa durumunu yeniden okur ve bu ekran kaybolur.
 */
function CashOpenGate({ onOpened }: { onOpened: () => void }): React.JSX.Element {
  const [opening, setOpening] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function submit(): void {
    setError(null)
    if (opening.trim() === '') {
      setError('Kasadaki para tutarını girin (boş da olabilir: 0)')
      return
    }
    setBusy(true)
    void window.api
      .cashOpen({ openingBalance: tlToKurus(opening), note: note || undefined })
      .then(() => onOpened())
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h2>Kasa Açılmadı</h2>
        <p className="muted">
          Bu cihazda açık kasa yok. Gün başı kasada bulunan para ile kasayı açmadan satış
          yapılamaz.
        </p>
        <form
          className="form-col"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <label className="form-field">
            Açılış Parası (TL)
            <input
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              placeholder="0"
              autoFocus
            />
          </label>
          <label className="form-field">
            Not (isteğe bağlı)
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Açılıyor…' : 'Kasayı Aç ve Başla'}
          </button>
        </form>
      </div>
    </div>
  )
}