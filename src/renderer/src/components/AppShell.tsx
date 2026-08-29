import { useEffect, useState } from 'react'
import type { User } from '@shared/types'
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

function roleLabel(role: User['role']): string {
  return role === 'admin' ? 'Yönetici' : 'Personel'
}

export default function AppShell({ user, onLogout }: Props): React.JSX.Element {
  const [page, setPage] = useState('dashboard')
  const [dataVer, setDataVer] = useState(0)

  useEffect(() => {
    const off = window.api.onDataChanged((v) => setDataVer(v))
    return off
  }, [])

  useEffect(() => {
    const handler = (e: Event): void => {
      const key = (e as CustomEvent<string>).detail
      if (NAV.some((n) => n.key === key && n.ready)) setPage(key)
    }
    window.addEventListener('nav:goto', handler)
    return () => window.removeEventListener('nav:goto', handler)
  }, [])

  const active = NAV.find((n) => n.key === page) ?? NAV[0]

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">Yazar Kasa</div>
        <nav className="nav">
          {NAV.map((item) => (
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
        {page === 'returns' && <ReturnsPage />}
        {page === 'exchanges' && <ExchangesPage />}
        {page === 'products' && <ProductsPage />}
        {page === 'categories' && <CategoriesPage />}
        {page === 'suppliers' && <SuppliersPage role={user.role} />}
        {page === 'purchases' && <PurchasesPage role={user.role} />}
        {page === 'debts' && <DebtsPage />}
        {page === 'reports' && <ReportsPage />}
        {page === 'settings' && <SettingsPage />}

        {page !== 'dashboard' && page !== 'sale' && page !== 'cash' && page !== 'customers' && page !== 'returns' && page !== 'exchanges' && page !== 'products' && page !== 'categories' && page !== 'suppliers' && page !== 'purchases' && page !== 'debts' && page !== 'reports' && page !== 'settings' && (
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