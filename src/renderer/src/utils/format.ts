export function formatKurus(n: number): string {
  return (
    (n / 100).toLocaleString('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' TL'
  )
}

export function kurusToTl(n: number): string {
  return (n / 100).toFixed(2)
}

export function tlToKurus(s: string): number {
  const num = parseFloat(String(s).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(num) ? Math.round(num * 100) : 0
}

export function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString('tr-TR')
}

export type PaymentMethod = 'cash' | 'card' | 'transfer'

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('tr-TR')
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('tr-TR')
}

export function todayInput(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function paymentMethodLabel(m: PaymentMethod): string {
  switch (m) {
    case 'cash':
      return 'Nakit'
    case 'card':
      return 'Kart'
    case 'transfer':
      return 'Havale'
  }
}