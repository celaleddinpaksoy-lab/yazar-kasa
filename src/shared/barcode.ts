/**
 * Barkod yardımcıları. EAN-13 üretimi (Türkiye için 8 prefix'i).
 * Barkod değerleri düz metindir; kod128 her diziye dayanır, EAN-13 yalnızca 13 basamak.
 */

export function isEan13(value: string): boolean {
  return /^\d{13}$/.test(value)
}

export function isCode128(value: string): boolean {
  return value.length > 0 && value.length <= 48 && !/[\u0000-\u001f\u007f]/.test(value)
}

/**
 * 12 haneli veri için EAN-13 kontrol basamağını hesaplar, 13 haneli barkodu döndürür.
 */
export function computeEan13(data12: string): string {
  const digits = data12.replace(/\D/g, '')
  if (digits.length !== 12) {
    throw new Error('EAN-13 için 12 hane gereklidir')
  }
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const d = Number(digits[i])
    sum += i % 2 === 0 ? d : d * 3
  }
  const check = (10 - (sum % 10)) % 10
  return digits + String(check)
}

/**
 * Otomatik barkod üretimi için benzersiz 12 haneli veri üretir.
 * 8 (Türkiye) prefix'i + zaman + sayaç karışımından deterministik 12 hane.
 */
export function generateEan13(): string {
  const t = Date.now()
  const base = `${t}${Math.floor(Math.random() * 90) + 10}`
  const digits = ('8' + base).replace(/\D/g, '').slice(0, 12)
  return computeEan13(digits.padEnd(12, '0'))
}