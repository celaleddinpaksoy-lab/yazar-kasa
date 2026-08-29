import { createContext, useContext } from 'react'

/**
 * VERİ DEĞİŞİM SÜRÜMÜ — main süreç her atomik işlem sonrası artırır
 * (data:changed yayını). Ekranlar bu sürümü load effectlerine ekleyince
 * veri değişince otomatik yenilenirler (manuel refresh yok).
 */
export const DataContext = createContext(0)

export function useDataVersion(): number {
  return useContext(DataContext)
}