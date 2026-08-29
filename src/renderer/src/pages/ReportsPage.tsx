import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { DaySlice, PeriodKey, PeriodReport } from '@shared/types'
import { useDataVersion } from '../context/DataContext'
import { formatKurus, formatQty } from '../utils/format'

type Mode = 'period' | 'day'

function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function periodRange(key: PeriodKey): { from: number; to: number } {
  const now = new Date()
  const to = startOfDay(Date.now()) + 86400000
  const fromMs = startOfDay(Date.now())
  switch (key) {
    case 'today':
      return { from: fromMs, to }
    case 'week': {
      const dow = (now.getDay() + 6) % 7
      return { from: fromMs - dow * 86400000, to }
    }
    case 'month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), to }
    case 'month6':
      return { from: new Date(now.getFullYear(), now.getMonth() - 5, 1).getTime(), to }
    case 'year':
      return { from: new Date(now.getFullYear(), 0, 1).getTime(), to }
  }
}

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'today', label: 'Bugün' },
  { key: 'week', label: 'Bu Hafta' },
  { key: 'month', label: 'Bu Ay' },
  { key: 'month6', label: '6 Ay' },
  { key: 'year', label: 'Bu Yıl' }
]

export default function ReportsPage(): React.JSX.Element {
  const dataVer = useDataVersion()
  const [key, setKey] = useState<PeriodKey>('today')
  const [mode, setMode] = useState<Mode>('period')
  const [day, setDay] = useState<DaySlice | null>(null)
  const [report, setReport] = useState<PeriodReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const range = useMemo(() => (mode === 'period' ? periodRange(key) : dayToRange(day)), [key, mode, day])
  const title = mode === 'period' ? PERIODS.find((p) => p.key === key)!.label : `Gün: ${day?.label}`

  const load = useCallback(async () => {
    setReport(await window.api.reportsPeriod(range.from, range.to))
  }, [dataVer, range.from, range.to])

  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [load])

  function openDay(d: DaySlice): void {
    setDay(d)
    setMode('day')
  }

  function backToPeriod(): void {
    setMode('period')
    setDay(null)
  }

  if (error) return <p className="error">{error}</p>

  return (
    <div className="page">
      <header className="page-head">
        <h1>Raporlar</h1>
      </header>

      <div className="seg-row">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            className={`seg-btn ${mode === 'period' && key === p.key ? 'active' : ''}`}
            onClick={() => {
              setKey(p.key)
              setMode('period')
              setDay(null)
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {report && (
        <>
          <div className="panel">
            <div className="panel-row">
              <h3>{title} Detayı</h3>
              {mode === 'day' && (
                <button className="btn small" onClick={backToPeriod}>
                  Döneme dön
                </button>
              )}
            </div>
            <div className="grid-4">
              <div className="mini-stat">
                <span className="mini-label">Net Ciro</span>
                <span className="mini-value">{formatKurus(report.netRevenue)}</span>
                <span className="mini-sub">{report.salesCount} satış</span>
              </div>
              <div className="mini-stat">
                <span className="mini-label">Kâr</span>
                <span className="mini-value positive">{formatKurus(report.profit)}</span>
                <span className="mini-sub">indirim: {formatKurus(report.discountTotal)}</span>
              </div>
              <div className="mini-stat">
                <span className="mini-label">İade</span>
                <span className="mini-value danger">-{formatKurus(report.returnTotal)}</span>
                <span className="mini-sub">{report.returnCount} iade</span>
              </div>
              <div className="mini-stat">
                <span className="mini-label">Değişim</span>
                <span className="mini-value">{formatKurus(report.exchangeNet)}</span>
                <span className="mini-sub">
                  giden {formatKurus(report.exchangeOut)} / gelen {formatKurus(report.exchangeIn)}
                </span>
              </div>
              <div className="mini-stat">
                <span className="mini-label">Nakit Girişi</span>
                <span className="mini-value">{formatKurus(report.moneyIn)}</span>
                <span className="mini-sub">tahsilat: {formatKurus(report.collectedDebt)}</span>
              </div>
              <div className="mini-stat">
                <span className="mini-label">Kasadan Çıkış</span>
                <span className="mini-value danger">-{formatKurus(report.cashExpense)}</span>
                <span className="mini-sub">alış + tedarikçi + iade</span>
              </div>
              <div className="mini-stat">
                <span className="mini-label">Alışlar</span>
                <span className="mini-value">{formatKurus(report.purchaseTotal)}</span>
                <span className="mini-sub">{report.purchaseCount} alış, {
                  report.supplierReturnTotal !== 0 ? `iade ${formatKurus(report.supplierReturnTotal)}` : 'iade yok'
                }</span>
              </div>
              <div className="mini-stat">
                <span className="mini-label">Tedarikçi Ödemesi</span>
                <span className="mini-value danger">-{formatKurus(report.paidSupplier)}</span>
                <span className="mini-sub">veresiye satış: {formatKurus(report.creditSales)}</span>
              </div>
            </div>
          </div>

          <div className="grid-2">
            <div className="panel">
              <h3>Ürün Satışları</h3>
              {report.productSales.length === 0 ? (
                <p className="muted">Bu dönemde satış yok.</p>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Ürün</th>
                      <th className="num">Sat.</th>
                      <th className="num">Tutar</th>
                      <th className="num">İade</th>
                      <th className="num">Değişim</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.productSales.map((p) => (
                      <tr key={p.productId}>
                        <td>{p.name}</td>
                        <td className="num">{formatQty(p.soldQty)}</td>
                        <td className="num">{formatKurus(p.soldTotal)}</td>
                        <td className="num">{formatQty(p.returnedQty)}</td>
                        <td className="num">
                          {p.exchangeOutQty > 0 || p.exchangeInQty > 0
                            ? `${formatQty(p.exchangeOutQty)}/${formatQty(p.exchangeInQty)}`
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="panel">
              <h3>Günler</h3>
              {report.days.length === 0 ? (
                <p className="muted">Kayıt yok.</p>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Gün</th>
                      <th className="num">Satış</th>
                      <th className="num">Toplam</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.days.map((d, i) =>
                      i === 0 && d.label === 'toplam' ? (
                        <tr key="toplam" className="row-active">
                          <td>Dönem Toplamı</td>
                          <td className="num">{d.count}</td>
                          <td className="num">{formatKurus(d.total)}</td>
                        </tr>
                      ) : (
                        <tr key={d.label} onClick={() => openDay(d)} title="Bu günün detayını gör">
                          <td>{d.label}</td>
                          <td className="num">{d.count}</td>
                          <td className="num">{formatKurus(d.total)}</td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function dayToRange(day: DaySlice | null): { from: number; to: number } {
  if (!day || day.label === 'toplam') return periodRange('today')
  const [y, m, d] = day.label.split('-').map(Number)
  const from = new Date(y, m - 1, d).getTime()
  return { from, to: from + 86400000 }
}