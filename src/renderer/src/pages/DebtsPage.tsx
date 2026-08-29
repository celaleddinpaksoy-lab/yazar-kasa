import React, { useCallback, useEffect, useState } from 'react'
import type { CustomerWithBalance, SupplierWithBalance } from '@shared/types'
import { useDataVersion } from '../context/DataContext'
import { formatKurus } from '../utils/format'

export default function DebtsPage(): React.JSX.Element {
  const dataVer = useDataVersion()
  const [customers, setCustomers] = useState<CustomerWithBalance[]>([])
  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [c, s] = await Promise.all([window.api.customersWithBalance(), window.api.suppliersWithBalance()])
    setCustomers(c)
    setSuppliers(s)
  }, [dataVer])

  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [load])

  const totalReceivable = customers.reduce((s, c) => s + Math.max(0, c.balance), 0)
  const totalPayable = suppliers.reduce((s, c) => s + Math.max(0, c.balance), 0)

  if (error) return <p className="error">{error}</p>

  return (
    <div className="page">
      <header className="page-head">
        <h1>Borç / Alacak Defteri</h1>
      </header>

      <div className="grid-4">
        <div className="panel stat">
          <span className="stat-label">Toplam Alacak (Müşteri)</span>
          <span className="stat-value">{formatKurus(totalReceivable)}</span>
          <span className="stat-sub">{customers.filter((c) => c.balance > 0).length} borçlu müşteri</span>
        </div>
        <div className="panel stat">
          <span className="stat-label">Toplam Borç (Tedarikçi)</span>
          <span className="stat-value danger">{formatKurus(totalPayable)}</span>
          <span className="stat-sub">{suppliers.filter((s) => s.balance > 0).length} borçlu kalem</span>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h3>Müşteri Alacakları</h3>
          {customers.length === 0 ? (
            <p className="muted">Kayıtlı müşteri yok.</p>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Müşteri</th>
                  <th>Telefon</th>
                  <th className="num">Bakiye</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} className={c.balance > 0 ? '' : 'muted-row'}>
                    <td>{c.name}</td>
                    <td>{c.phone ?? '-'}</td>
                    <td className={`num ${c.balance > 0 ? '' : ''}`}>{formatKurus(c.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <h3>Tedarikçi Borçları</h3>
          {suppliers.length === 0 ? (
            <p className="muted">Kayıtlı tedarikçi yok.</p>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tedarikçi</th>
                  <th>Telefon</th>
                  <th className="num">Bakiye</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className={s.balance > 0 ? '' : 'muted-row'}>
                    <td>{s.name}</td>
                    <td>{s.phone ?? '-'}</td>
                    <td className={`num ${s.balance > 0 ? 'danger' : 'positive'}`}>{formatKurus(s.balance)}</td>
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