import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppApi,
  CategoryInput,
  ProductInput,
  ProductQuery,
  CustomerInput,
  CompleteSalePayload,
  OpenShiftInput,
  CloseShiftInput,
  CustomerMovementInput,
  CustomerPayInput,
  CompleteReturnPayload,
  CompleteExchangePayload,
  CompletePurchasePayload,
  PurchaseKind,
  SupplierInput,
  SupplierMovementInput,
  SupplierPayInput
} from '@shared/types'

const api: AppApi = {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  getVersions: () => process.versions,
  authLogin: (username, password) => ipcRenderer.invoke('auth:login', username, password),
  authMe: () => ipcRenderer.invoke('auth:me'),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  categoriesList: () => ipcRenderer.invoke('categories:list'),
  categoriesCreate: (input: CategoryInput) => ipcRenderer.invoke('categories:create', input),
  categoriesUpdate: (id: number, input: CategoryInput) =>
    ipcRenderer.invoke('categories:update', id, input),
  categoriesRemove: (id: number) => ipcRenderer.invoke('categories:remove', id),
  productsList: (query?: ProductQuery) => ipcRenderer.invoke('products:list', query),
  productsGet: (id: number) => ipcRenderer.invoke('products:get', id),
  productsCreate: (input: ProductInput) => ipcRenderer.invoke('products:create', input),
  productsUpdate: (id: number, input: ProductInput) =>
    ipcRenderer.invoke('products:update', id, input),
  productsRemove: (id: number) => ipcRenderer.invoke('products:remove', id),
  customersList: () => ipcRenderer.invoke('customers:list'),
  customersGet: (id: number) => ipcRenderer.invoke('customers:get', id),
  customersCreate: (input: CustomerInput) => ipcRenderer.invoke('customers:create', input),
  customersUpdate: (id: number, input: CustomerInput) =>
    ipcRenderer.invoke('customers:update', id, input),
  customersBalance: (id: number) => ipcRenderer.invoke('customers:balance', id),
  customersWithBalance: () => ipcRenderer.invoke('customers:withBalance'),
  customersDetail: (id: number) => ipcRenderer.invoke('customers:detail', id),
  customersDebtAdd: (id: number, input: CustomerMovementInput) =>
    ipcRenderer.invoke('customers:debtAdd', id, input),
  customersDebtPay: (id: number, input: CustomerPayInput) =>
    ipcRenderer.invoke('customers:debtPay', id, input),
  customersMovementEdit: (movementId: number, input: CustomerMovementInput) =>
    ipcRenderer.invoke('customers:movementEdit', movementId, input),
  customersMovementRemove: (movementId: number) =>
    ipcRenderer.invoke('customers:movementRemove', movementId),
  salesComplete: (input: CompleteSalePayload) => ipcRenderer.invoke('sales:complete', input),
  holdsList: () => ipcRenderer.invoke('holds:list'),
  holdsCreate: (input: { customerName?: string; itemsJson: string; total: number }) =>
    ipcRenderer.invoke('holds:create', input),
  holdsRemove: (id: number) => ipcRenderer.invoke('holds:remove', id),
  holdsComplete: (id: number) => ipcRenderer.invoke('holds:complete', id),
  cashGetOpen: () => ipcRenderer.invoke('cash:getOpen'),
  cashOpen: (input: OpenShiftInput) => ipcRenderer.invoke('cash:open', input),
  cashClose: (shiftId: number, input: CloseShiftInput) =>
    ipcRenderer.invoke('cash:close', shiftId, input),
  cashList: () => ipcRenderer.invoke('cash:list'),
  returnsSales: () => ipcRenderer.invoke('returns:sales'),
  returnsSaleReturnable: (saleId: number) => ipcRenderer.invoke('returns:saleReturnable', saleId),
  returnsComplete: (input: CompleteReturnPayload) => ipcRenderer.invoke('returns:complete', input),
  returnsList: () => ipcRenderer.invoke('returns:list'),
  exchangesComplete: (input: CompleteExchangePayload) =>
    ipcRenderer.invoke('exchanges:complete', input),
  exchangesList: () => ipcRenderer.invoke('exchanges:list'),
  suppliersList: () => ipcRenderer.invoke('suppliers:list'),
  suppliersWithBalance: () => ipcRenderer.invoke('suppliers:withBalance'),
  suppliersCreate: (input: SupplierInput) => ipcRenderer.invoke('suppliers:create', input),
  suppliersUpdate: (id: number, input: SupplierInput) =>
    ipcRenderer.invoke('suppliers:update', id, input),
  suppliersRemove: (id: number) => ipcRenderer.invoke('suppliers:remove', id),
  suppliersDetail: (id: number) => ipcRenderer.invoke('suppliers:detail', id),
  suppliersDebtAdd: (id: number, input: SupplierMovementInput) =>
    ipcRenderer.invoke('suppliers:debtAdd', id, input),
  suppliersPay: (id: number, input: SupplierPayInput) =>
    ipcRenderer.invoke('suppliers:pay', id, input),
  suppliersMovementEdit: (movementId: number, input: SupplierMovementInput) =>
    ipcRenderer.invoke('suppliers:movementEdit', movementId, input),
  suppliersMovementRemove: (movementId: number) =>
    ipcRenderer.invoke('suppliers:movementRemove', movementId),
  purchasesComplete: (input: CompletePurchasePayload) =>
    ipcRenderer.invoke('purchases:complete', input),
  purchasesSupplierReturn: (input: CompletePurchasePayload) =>
    ipcRenderer.invoke('purchases:supplierReturn', input),
  purchasesList: (kind?: PurchaseKind) => ipcRenderer.invoke('purchases:list', kind),
  purchasesDetail: (id: number) => ipcRenderer.invoke('purchases:detail', id),
  purchasesUpdate: (id: number, input: CompletePurchasePayload) =>
    ipcRenderer.invoke('purchases:update', id, input),
  purchasesRemove: (id: number) => ipcRenderer.invoke('purchases:remove', id),
  authChangePassword: (current: string, next: string) =>
    ipcRenderer.invoke('auth:changePassword', current, next),
  dashboardSummary: () => ipcRenderer.invoke('dashboard:summary'),
  reportsPeriod: (from: number, to: number) => ipcRenderer.invoke('reports:period', from, to),
  backupsList: () => ipcRenderer.invoke('backups:list'),
  backupCreate: () => ipcRenderer.invoke('backups:create'),
  backupImport: (name: string, data: ArrayBuffer) => ipcRenderer.invoke('backups:import', name, data),
  backupRestore: (id: number) => ipcRenderer.invoke('backups:restore', id),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  onDataChanged: (cb: (version: number) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, version: number): void => cb(version)
    ipcRenderer.on('data:changed', listener)
    return () => ipcRenderer.removeListener('data:changed', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)