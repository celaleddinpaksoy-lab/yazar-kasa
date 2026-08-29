import React, { useCallback, useEffect, useState } from 'react'
import type { DashboardSummary } from '@shared/types'
import { useDataVersion } from '../context/DataContext'
import { formatKurus, formatQty } from '../utils/format'

export default function DashboardPage(): React.JSX.Element {
  const dataVer = useDataVersion()
  const [data, setData] = useState<DashboardSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setData(await window.api.dashboardSummary())
  }, [dataVer])

  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [load])

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Yükleniyor…</p>

  const maxBar = Math.max(1, ...data.last7.map((b) => b.total))
  const overdueCount = data.dueReminders.filter((r) => r.overdue).length

  return (
    <div className="page">
      <header className="page-head">
        <h1>Dashboard</h1>
      </header>

      <div className="grid-4">
        <div className="panel stat">
          <span className="stat-label">Bugün Net Ciro</span>
          <span className="stat-value">{formatKurus(data.today.total)}</span>
          <span className="stat-sub">{data.today.count} satış</span>
        </div>
        <div className="panel stat">
          <span className="stat-label">Bugün Kâr</span>
          <span className="stat-value positive">{formatKurus(data.today.profit)}</span>
          <span className="stat-sub">iade/değişim dahil</span>
        </div>
        <div className="panel stat">
          <span className="stat-label">Alacağımız</span>
          <span className="stat-value">{formatKurus(data.customerReceivableTotal)}</span>
          <span className="stat-sub">müşteri borçları</span>
        </div>
        <div className="panel stat">
          <span className="stat-label">Borcumuz</span>
          <span className="stat-value danger">{formatKurus(data.supplierPayableTotal)}</span>
          <span className="stat-sub">tedarikçi borçları</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-row">
          <h3>Son 7 Gün Net Ciro</h3>
          <div className="mini-stats">
            <span>İade: {formatKurus(data.today.returnTotal)}</span>
            <span>Değişim farkı: {formatKurus(data.today.exchangeNet)}</span>
            <span>Nakit giriş: {formatKurus(data.today.moneyIn)}</span>
            <span>Kasadan çıkış: {formatKurus(data.today.cashExpense)}</span>
          </div>
        </div>
        <div className="bars">
          {data.last7.map((b) => (
            <div key={b.label} className="bar-col" title={`${b.label}: ${formatKurus(b.total)} (kâr ${formatKurus(b.profit)})`}>
              <div className="bar-track">
                <div className="bar-fill" style={{ height: `${Math.max(2, (b.total / maxBar) * 100)}%` }} />
              </div>
              <span className="bar-label">{b.label.slice(5)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-row">
            <h3>Düşük Stok</h3>
            <button className="btn small" onClick={() => setPageNav('products')}>
              Ürünler
            </button>
          </div>
          {data.lowStock.length === 0 ? (
            <p className="muted">Düşük stoklu ürün yok.</p>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Ürün</th>
                  <th className="num">Stok</th>
                  <th className="num">Min.</th>
                </tr>
              </thead>
              <tbody>
                {data.lowStock.map((p) => (
                  <tr key={p.productId}>
                    <td>{p.name}</td>
                    <td className="num danger">{formatQty(p.stockQty)}</td>
                    <td className="num">{formatQty(p.minStock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <div className="panel-row">
            <h3>Vade Hatırlatma</h3>
            {overdueCount > 0 && <span className="badge badge-danger">{overdueCount} gecikmiş</span>}
          </div>
          {data.dueReminders.length === 0 ? (
            <p className="muted">Taksitli borcu olan müşteri yok.</p>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Müşteri</th>
                  <th className="num">Bakiye</th>
                  <th>Vade</th>
                </tr>
              </thead>
              <tbody>
                {data.dueReminders.map((r) => (
                  <tr key={r.customerId} className={r.overdue ? 'row-active' : ''}>
                    <td>{r.name}</td>
                    <td className="num">{formatKurus(r.balance)}</td>
                    <td>
                      {r.nextDueDate} {r.overdue && <span className="badge badge-danger">Gecikti</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function setPageNav(key: string): void {
  window.dispatchEvent(new CustomEvent('nav:goto', { detail: key }))
}