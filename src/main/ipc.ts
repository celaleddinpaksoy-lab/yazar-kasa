import { app, ipcMain, BrowserWindow } from 'electron'
import { getDbPath } from './db'
import { listBackups, takeBackup, importBackup, restoreBackup } from './repositories/backups'
import {
  verifyCredentials,
  verifyPassword,
  getPasswordHash,
  updatePassword
} from './repositories/users'
import {
  listCategories,
  createCategory,
  updateCategory,
  removeCategory
} from './repositories/categories'
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  removeProduct
} from './repositories/products'
import {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  getCustomerBalance,
  listCustomersWithBalance,
  getCustomerDetail,
  addManualDebt,
  payCustomerDebt,
  editManualMovement,
  removeManualMovement
} from './repositories/customers'
import { completeSale } from './services/sales'
import {
  listActiveHolds,
  createHold,
  removeHold,
  completeHold
} from './repositories/holds'
import { getOpenShift, openShift, closeShift, listShifts } from './repositories/cash'
import {
  listSalesForReturn,
  getSaleReturnable,
  findSaleForReturnByReceipt,
  completeReturn,
  listReturns
} from './services/returns'
import { completeExchange, listExchanges } from './services/exchanges'
import { dashboardSummary, periodReport } from './services/reports'
import {
  completePurchase,
  completeSupplierReturn,
  getPurchaseDetail,
  updatePurchase,
  removePurchase
} from './services/purchases'
import {
  listSuppliers,
  listSuppliersWithBalance,
  createSupplier,
  updateSupplier,
  removeSupplier,
  getSupplierDetail,
  addManualSupplierDebt,
  paySupplier,
  listSupplierPayments,
  editManualSupplierMovement,
  removeManualSupplierMovement,
  listPurchases
} from './repositories/suppliers'
import type {
  AppInfo,
  LoginResult,
  User,
  CategoryInput,
  ProductInput,
  ProductQuery,
  CustomerInput,
  CompleteSaleInput,
  SaleResult,
  Hold,
  OpenShiftInput,
  CloseShiftInput,
  CustomerMovementInput,
  CustomerPayInput,
  CompleteReturnInput,
  CompleteExchangeInput,
  CompletePurchaseInput,
  CompletePurchasePayload,
  ChangePasswordResult,
  PurchaseKind,
  SupplierInput,
  SupplierMovementInput,
  SupplierPayInput
} from '@shared/types'

let session: User | null = null
let dataVersion = 0

/**
 * VERI DEĞIŞİM YAYINI (reactive sync).
 * Her atomik işlem tamamlandığında tek bir artan sürüm numarası yayınlanır.
 * Tüm açık ekranlar abone olup sürüm değişince ilgili verilerini yeniler.
 */
function broadcastDataChanged(): void {
  dataVersion += 1
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('data:changed', dataVersion)
  }
}

export function getCurrentUser(): User | null {
  return session
}

export function registerIpcHandlers(): void {
  ipcMain.handle('app:info', (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      dbPath: getDbPath()
    }
  })

  ipcMain.handle('auth:login', (_e, username: string, password: string): LoginResult => {
    const user = verifyCredentials(String(username ?? '').trim(), String(password ?? ''))
    if (!user) {
      return { ok: false, error: 'Kullanıcı adı veya şifre hatalı' }
    }
    session = user
    return { ok: true, user }
  })

  ipcMain.handle('auth:me', (): User | null => session)

  ipcMain.handle('auth:logout', (): void => {
    session = null
  })

  ipcMain.handle('categories:list', () => listCategories())
  ipcMain.handle('categories:create', (_e, input: CategoryInput) => {
    const c = createCategory(input)
    broadcastDataChanged()
    return c
  })
  ipcMain.handle('categories:update', (_e, id: number, input: CategoryInput) => {
    const c = updateCategory(id, input)
    broadcastDataChanged()
    return c
  })
  ipcMain.handle('categories:remove', (_e, id: number) => {
    removeCategory(id)
    broadcastDataChanged()
  })

  ipcMain.handle('products:list', (_e, query?: ProductQuery) => listProducts(query))
  ipcMain.handle('products:get', (_e, id: number) => getProduct(id))
  ipcMain.handle('products:create', (_e, input: ProductInput) => {
    const p = createProduct(input)
    broadcastDataChanged()
    return p
  })
  ipcMain.handle('products:update', (_e, id: number, input: ProductInput) => {
    const p = updateProduct(id, input)
    broadcastDataChanged()
    return p
  })
  ipcMain.handle('products:remove', (_e, id: number) => {
    removeProduct(id)
    broadcastDataChanged()
  })

  ipcMain.handle('customers:list', () => listCustomers())
  ipcMain.handle('customers:get', (_e, id: number) => getCustomer(id))
  ipcMain.handle('customers:create', (_e, input: CustomerInput) => {
    const c = createCustomer(input)
    broadcastDataChanged()
    return c
  })
  ipcMain.handle('customers:update', (_e, id: number, input: CustomerInput) => {
    const c = updateCustomer(id, input)
    broadcastDataChanged()
    return c
  })
  ipcMain.handle('customers:balance', (_e, id: number) => getCustomerBalance(id))
  ipcMain.handle('customers:withBalance', () => listCustomersWithBalance())
  ipcMain.handle('customers:detail', (_e, id: number) => getCustomerDetail(id))

  const requireAdmin = (): User => {
    const user = session
    if (!user) throw new Error('Oturum açık değil')
    if (user.role !== 'admin') throw new Error('Bu işlem için yönetici yetkisi gerekir')
    return user
  }

  ipcMain.handle('customers:debtAdd', (_e, id: number, input: CustomerMovementInput) => {
    const d = addManualDebt(id, input, requireAdmin().id)
    broadcastDataChanged()
    return d
  })
  ipcMain.handle('customers:debtPay', (_e, id: number, input: CustomerPayInput) => {
    const d = payCustomerDebt(id, input, requireAdmin().id)
    broadcastDataChanged()
    return d
  })
  ipcMain.handle('customers:movementEdit', (_e, movementId: number, input: CustomerMovementInput) => {
    requireAdmin()
    const d = editManualMovement(movementId, input)
    broadcastDataChanged()
    return d
  })
  ipcMain.handle('customers:movementRemove', (_e, movementId: number) => {
    requireAdmin()
    const d = removeManualMovement(movementId)
    broadcastDataChanged()
    return d
  })

  ipcMain.handle('sales:complete', (_e, input: CompleteSaleInput): SaleResult => {
    const user = session
    if (!user) return { ok: false, error: 'Oturum açık değil' }
    try {
      const receipt = completeSale({ ...input, createdBy: user.id })
      broadcastDataChanged()
      return { ok: true, receipt }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('holds:list', () => listActiveHolds())
  ipcMain.handle('holds:create', (_e, input: { customerName?: string; itemsJson: string; total: number }): Hold => {
    const user = session
    if (!user) throw new Error('Oturum açık değil')
    const h = createHold({ ...input, createdBy: user.id })
    broadcastDataChanged()
    return h
  })
  ipcMain.handle('holds:remove', (_e, id: number) => {
    removeHold(id)
    broadcastDataChanged()
  })
  ipcMain.handle('holds:complete', (_e, id: number) => {
    completeHold(id)
    broadcastDataChanged()
  })

  ipcMain.handle('cash:getOpen', () => getOpenShift())
  ipcMain.handle('cash:open', (_e, input: OpenShiftInput) => {
    const user = session
    if (!user) throw new Error('Oturum açık değil')
    const s = openShift({ ...input, createdBy: user.id })
    broadcastDataChanged()
    return s
  })
  ipcMain.handle('cash:close', (_e, shiftId: number, input: CloseShiftInput) => {
    const s = closeShift({ ...input, shiftId })
    broadcastDataChanged()
    return s
  })
  ipcMain.handle('cash:list', () => listShifts())

  ipcMain.handle('returns:sales', () => listSalesForReturn())
  ipcMain.handle('returns:saleReturnable', (_e, saleId: number) => getSaleReturnable(saleId))
  ipcMain.handle('sales:findByReceipt', (_e, receiptNo: string) =>
    findSaleForReturnByReceipt(receiptNo)
  )
  ipcMain.handle('returns:complete', (_e, input: CompleteReturnInput) => {
    const user = session
    if (!user) return { ok: false, error: 'Oturum açık değil' }
    try {
      const r = completeReturn({ ...input, createdBy: user.id })
      broadcastDataChanged()
      return { ok: true, ...r }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('returns:list', () => listReturns())

  ipcMain.handle('exchanges:complete', (_e, input: CompleteExchangeInput) => {
    const user = session
    if (!user) return { ok: false, error: 'Oturum açık değil' }
    try {
      const e = completeExchange({ ...input, createdBy: user.id })
      broadcastDataChanged()
      return { ok: true, ...e }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('exchanges:list', () => listExchanges())

  // ---------- TEDARİKÇİLER ----------
  ipcMain.handle('suppliers:list', () => listSuppliers())
  ipcMain.handle('suppliers:withBalance', () => listSuppliersWithBalance())
  ipcMain.handle('suppliers:detail', (_e, id: number) => getSupplierDetail(id))
  ipcMain.handle('suppliers:create', (_e, input: SupplierInput) => {
    requireAdmin()
    const s = createSupplier(input)
    broadcastDataChanged()
    return s
  })
  ipcMain.handle('suppliers:update', (_e, id: number, input: SupplierInput) => {
    requireAdmin()
    const s = updateSupplier(id, input)
    broadcastDataChanged()
    return s
  })
  ipcMain.handle('suppliers:remove', (_e, id: number) => {
    requireAdmin()
    removeSupplier(id)
    broadcastDataChanged()
  })
  ipcMain.handle('suppliers:debtAdd', (_e, id: number, input: SupplierMovementInput) => {
    const d = addManualSupplierDebt(id, input, requireAdmin().id)
    broadcastDataChanged()
    return d
  })
  ipcMain.handle('suppliers:pay', (_e, id: number, input: SupplierPayInput) => {
    const d = paySupplier(id, input, requireAdmin().id)
    broadcastDataChanged()
    return d
  })
  ipcMain.handle('suppliers:payments', () => listSupplierPayments())
  ipcMain.handle('suppliers:movementEdit', (_e, movementId: number, input: SupplierMovementInput) => {
    requireAdmin()
    const d = editManualSupplierMovement(movementId, input)
    broadcastDataChanged()
    return d
  })
  ipcMain.handle('suppliers:movementRemove', (_e, movementId: number) => {
    requireAdmin()
    const d = removeManualSupplierMovement(movementId)
    broadcastDataChanged()
    return d
  })

  // ---------- ALIŞ DEFTERİ ----------
  ipcMain.handle('purchases:list', (_e, kind?: PurchaseKind) => listPurchases(kind))
  ipcMain.handle('purchases:detail', (_e, id: number) => getPurchaseDetail(id))
  ipcMain.handle('purchases:complete', (_e, input: CompletePurchaseInput) => {
    const user = requireAdmin()
    try {
      const p = completePurchase({ ...input, createdBy: user.id })
      broadcastDataChanged()
      return { ok: true, purchaseNo: p.purchaseNo, total: p.total, debtAmount: p.debtAmount }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('purchases:supplierReturn', (_e, input: CompletePurchaseInput) => {
    const user = requireAdmin()
    try {
      const p = completeSupplierReturn({ ...input, createdBy: user.id })
      broadcastDataChanged()
      return { ok: true, purchaseNo: p.purchaseNo, total: p.total, debtAmount: p.debtAmount }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('purchases:update', (_e, id: number, input: CompletePurchasePayload) => {
    requireAdmin()
    try {
      const p = updatePurchase(id, input)
      broadcastDataChanged()
      return { ok: true, purchaseNo: p.purchaseNo, total: p.total, debtAmount: p.debtAmount }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('purchases:remove', (_e, id: number) => {
    requireAdmin()
    removePurchase(id)
    broadcastDataChanged()
  })

  // ---------- DASHBOARD + RAPORLAR ----------
  ipcMain.handle('dashboard:summary', () => dashboardSummary())
  ipcMain.handle('reports:period', (_e, from: number, to: number) =>
    periodReport(Number(from), Number(to))
  )

  // ---------- YEDEKLEME ----------
  ipcMain.handle('backups:list', () => listBackups())
  ipcMain.handle('backups:create', (_e) => {
    const user = requireAdmin()
    return takeBackup('manual', user.id, 'Manuel yedek')
  })
  ipcMain.handle('backups:import', (_e, name: string, data: ArrayBuffer) => {
    const user = requireAdmin()
    return importBackup(name, new Uint8Array(data), user.id)
  })
  ipcMain.handle('backups:restore', (_e, id: number) => {
    requireAdmin()
    restoreBackup(id)
  })

  // ---------- GÜNCELLEME ----------
  ipcMain.handle('update:check', (): { ok: boolean; message: string } => {
    if (!app.isPackaged) {
      return { ok: true, message: 'Geliştirme sürümü: uzaktan güncelleme yalnızca paketlenmiş sürümde çalışır.' }
    }
    return { ok: true, message: `Güncelleme kontrolü başlatıldı (sürüm ${app.getVersion()}).` }
  })

  // ---------- AYARLAR ----------
  ipcMain.handle(
    'auth:changePassword',
    (_e, current: string, next: string): ChangePasswordResult => {
      const user = session
      if (!user) return { ok: false, error: 'Oturum açık değil' }
      const hash = getPasswordHash(user.id)
      if (!hash || !verifyPassword(String(current ?? ''), hash)) {
        return { ok: false, error: 'Mevcut şifre hatalı' }
      }
      const newPassword = String(next ?? '')
      if (newPassword.length < 4) {
        return { ok: false, error: 'Yeni şifre en az 4 karakter olmalı' }
      }
      updatePassword(user.id, newPassword)
      return { ok: true }
    }
  )
}