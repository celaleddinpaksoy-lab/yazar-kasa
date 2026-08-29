export type Role = 'admin' | 'personel'

export interface User {
  id: number
  username: string
  name: string
  role: Role
  isActive: boolean
}

export interface LoginResult {
  ok: boolean
  user?: User
  error?: string
}

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
  arch: string
  dbPath: string
}

export interface Category {
  id: number
  name: string
  sortOrder: number
}

export interface CategoryInput {
  name: string
  sortOrder?: number
}

export interface Product {
  id: number
  barcode: string
  name: string
  categoryId: number | null
  categoryName: string | null
  purchasePrice: number
  salePrice: number
  stockQty: number
  minStock: number
  image: string | null
  note: string | null
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export interface ProductInput {
  barcode?: string
  name: string
  categoryId?: number | null
  purchasePrice?: number
  salePrice?: number
  stockQty?: number
  minStock?: number
  note?: string
  isActive?: boolean
}

export interface ProductQuery {
  search?: string
  categoryId?: number | null
  activeOnly?: boolean
}

export type PaymentMethod = 'cash' | 'card' | 'transfer'

export interface Customer {
  id: number
  name: string
  phone: string | null
  note: string | null
  installmentDay: number | null
  createdAt: number
  updatedAt: number
}

export interface CustomerInput {
  name: string
  phone?: string
  note?: string
  installmentDay?: number | null
}

export interface CustomerWithBalance {
  id: number
  name: string
  phone: string | null
  note: string | null
  installmentDay: number | null
  balance: number
  createdAt: number
  updatedAt: number
}

export interface CustomerMovement {
  id: number
  date: string
  amount: number
  balanceAfter: number
  source: string
  note: string | null
  isManual: boolean
  paymentMethod: PaymentMethod | null
  createdAt: number
}

export interface CustomerDetail {
  customer: Customer
  balance: number
  totalDebt: number
  totalPaid: number
  movements: CustomerMovement[]
}

export interface CustomerMovementInput {
  amount: number
  date: string
  note?: string
}

export interface CustomerPayInput extends CustomerMovementInput {
  paymentMethod: PaymentMethod
}

export interface SaleLineInput {
  productId: number
  quantity: number
  unitPrice: number
  discount: number
}

export interface CompleteSaleInput {
  items: SaleLineInput[]
  customerId: number | null
  paymentMethod: PaymentMethod
  amountPaid: number
  totalDiscount: number
  note?: string
  createdBy: number
}

export interface SaleReceiptItem {
  productId: number
  name: string
  barcode: string
  quantity: number
  unitPrice: number
  discount: number
  lineTotal: number
}

export interface SaleReceipt {
  receiptNo: string
  createdAt: number
  customerName: string | null
  subtotal: number
  discountTotal: number
  total: number
  paidAmount: number
  debtAmount: number
  isCredit: boolean
  paymentMethod: PaymentMethod
  items: SaleReceiptItem[]
}

export interface SaleResult {
  ok: boolean
  receipt?: SaleReceipt
  error?: string
}

export interface Hold {
  id: number
  holdNo: string
  customerName: string | null
  itemsJson: string
  total: number
  status: string
  createdAt: number
}

export interface CartLine {
  productId: number
  name: string
  barcode: string
  quantity: number
  unitPrice: number
  discount: number
  lineTotal: number
  stockQty: number
}

export interface ReturnableItem {
  productId: number
  name: string
  barcode: string
  quantity: number
  returnedQty: number
  remainingQty: number
  unitPrice: number
  lineTotal: number
}

export interface SaleSummary {
  id: number
  receiptNo: string
  createdAt: number
  customerName: string | null
  total: number
  status: string
}

export interface SaleForReturn {
  sale: SaleSummary
  items: ReturnableItem[]
}

export interface ReturnLineInput {
  productId: number
  quantity: number
  unitPrice: number
}

export interface CompleteReturnInput {
  originalSaleId: number | null
  customerId: number | null
  items: ReturnLineInput[]
  settlementDebt: number
  settlementCashBack: number
  refundMethod: PaymentMethod
  note?: string
  createdBy: number
}

export type CompleteReturnPayload = Omit<CompleteReturnInput, 'createdBy'>

export interface ReturnSummary {
  id: number
  returnNo: string
  createdAt: number
  customerName: string | null
  total: number
  settlementMethod: 'debt' | 'cash_back' | 'mixed'
  originalReceiptNo: string | null
}

export interface ReturnResult {
  ok: boolean
  returnNo?: string
  total?: number
  error?: string
}

export type ExchangeDirection = 'in' | 'out'

export type ExchangeSettlement = 'none' | 'cash' | 'card' | 'transfer' | 'debt'

export interface ExchangeLineInput {
  productId: number
  quantity: number
  unitPrice: number
  direction: ExchangeDirection
}

export interface CompleteExchangeInput {
  customerId: number | null
  items: ExchangeLineInput[]
  differenceSettlement: ExchangeSettlement
  note?: string
  createdBy: number
}

export type CompleteExchangePayload = Omit<CompleteExchangeInput, 'createdBy'>

export interface ExchangeSummary {
  id: number
  exchangeNo: string
  createdAt: number
  customerName: string | null
  totalIn: number
  totalOut: number
  difference: number
  differenceSettlement: ExchangeSettlement
  note: string | null
}

export interface ExchangeResult {
  ok: boolean
  exchangeNo?: string
  totalIn?: number
  totalOut?: number
  difference?: number
  error?: string
}

export interface Supplier {
  id: number
  name: string
  phone: string | null
  address: string | null
  note: string | null
  createdAt: number
  updatedAt: number
}

export interface SupplierInput {
  name: string
  phone?: string
  address?: string
  note?: string
}

export interface SupplierWithBalance extends Supplier {
  balance: number
}

export type PurchaseKind = 'purchase' | 'supplier_return'

export interface SupplierMovement {
  id: number
  date: string
  amount: number
  balanceAfter: number
  source: string
  note: string | null
  isManual: boolean
  createdBy: number | null
  createdAt: number
}

export interface SupplierDetail {
  supplier: Supplier
  balance: number
  totalDebt: number
  totalPaid: number
  movements: SupplierMovement[]
  purchases: PurchaseSummary[]
}

export interface SupplierMovementInput {
  amount: number
  date: string
  note?: string
}

export interface SupplierPayInput extends SupplierMovementInput {
  paymentMethod: PaymentMethod
}

export interface PurchaseLineInput {
  productId: number
  quantity: number
  unitCost: number
}

export interface CompletePurchaseInput {
  supplierId: number | null
  items: PurchaseLineInput[]
  paidAmount: number
  paymentMethod: PaymentMethod | null
  note?: string
  createdBy: number
}

export type CompletePurchasePayload = Omit<CompletePurchaseInput, 'createdBy'>

export interface PurchaseSummary {
  id: number
  purchaseNo: string
  kind: PurchaseKind
  supplierName: string | null
  purchaseDate: string
  total: number
  paidAmount: number
  debtAmount: number
  note: string | null
  createdAt: number
}

export interface PurchaseItem {
  productId: number
  name: string
  barcode: string
  quantity: number
  unitCost: number
  lineTotal: number
}

export interface PurchaseDetail {
  purchase: PurchaseSummary
  items: PurchaseItem[]
}

export interface PurchaseResult {
  ok: boolean
  purchaseNo?: string
  total?: number
  debtAmount?: number
  error?: string
}

export interface ChangePasswordResult {
  ok: boolean
  error?: string
}

export type PeriodKey = 'today' | 'week' | 'month' | 'month6' | 'year'

export type BackupKind = 'auto' | 'manual' | 'import' | 'safety'

export interface BackupInfo {
  id: number
  filename: string
  kind: BackupKind
  note: string | null
  size: number
  createdByName: string | null
  createdAt: number
}

export interface BarPoint {
  label: string
  total: number
  profit: number
  count: number
}

export interface LowStockItem {
  productId: number
  name: string
  barcode: string
  stockQty: number
  minStock: number
}

export interface DueReminder {
  customerId: number
  name: string
  phone: string | null
  balance: number
  nextDueDate: string
  overdue: boolean
}

export interface DashboardSummary {
  today: {
    total: number
    count: number
    profit: number
    returnTotal: number
    exchangeNet: number
    moneyIn: number
    cashExpense: number
  }
  lowStock: LowStockItem[]
  customerReceivableTotal: number
  supplierPayableTotal: number
  dueReminders: DueReminder[]
  last7: BarPoint[]
}

export interface PeriodProductRow {
  productId: number
  name: string
  barcode: string
  soldQty: number
  soldTotal: number
  returnedQty: number
  returnTotal: number
  exchangeOutQty: number
  exchangeInQty: number
}

export interface DaySlice {
  label: string
  total: number
  count: number
}

export interface PeriodReport {
  from: number
  to: number
  salesTotal: number
  salesCount: number
  discountTotal: number
  creditSales: number
  returnTotal: number
  returnCount: number
  exchangeIn: number
  exchangeOut: number
  exchangeNet: number
  exchangeCount: number
  netRevenue: number
  profit: number
  moneyIn: number
  cashExpense: number
  collectedDebt: number
  purchaseTotal: number
  purchaseCount: number
  supplierReturnTotal: number
  paidSupplier: number
  productSales: PeriodProductRow[]
  days: DaySlice[]
}

export interface CashShiftSummary {
  id: number
  openedAt: number
  closedAt: number | null
  openingBalance: number
  closingBalance: number | null
  expectedBalance: number | null
  cashIn: number
  totalSales: number
  salesCount: number
  difference: number | null
  status: 'open' | 'closed'
  openedByName: string
  note: string | null
}

export interface OpenShiftInput {
  openingBalance: number
  note?: string
}

export interface CloseShiftInput {
  closingBalance: number
  note?: string
}

export type CompleteSalePayload = Omit<CompleteSaleInput, 'createdBy'>

export interface AppApi {
  getAppInfo: () => Promise<AppInfo>
  getVersions: () => NodeJS.ProcessVersions
  authLogin: (username: string, password: string) => Promise<LoginResult>
  authMe: () => Promise<User | null>
  authLogout: () => Promise<void>
  categoriesList: () => Promise<Category[]>
  categoriesCreate: (input: CategoryInput) => Promise<Category>
  categoriesUpdate: (id: number, input: CategoryInput) => Promise<Category>
  categoriesRemove: (id: number) => Promise<void>
  productsList: (query?: ProductQuery) => Promise<Product[]>
  productsCreate: (input: ProductInput) => Promise<Product>
  productsUpdate: (id: number, input: ProductInput) => Promise<Product>
  productsRemove: (id: number) => Promise<void>
  productsGet: (id: number) => Promise<Product | null>
  customersList: () => Promise<Customer[]>
  customersCreate: (input: CustomerInput) => Promise<Customer>
  customersUpdate: (id: number, input: CustomerInput) => Promise<Customer>
  customersGet: (id: number) => Promise<Customer | null>
  customersBalance: (id: number) => Promise<number>
  customersWithBalance: () => Promise<CustomerWithBalance[]>
  customersDetail: (id: number) => Promise<CustomerDetail>
  customersDebtAdd: (id: number, input: CustomerMovementInput) => Promise<CustomerDetail>
  customersDebtPay: (id: number, input: CustomerPayInput) => Promise<CustomerDetail>
  customersMovementEdit: (
    movementId: number,
    input: CustomerMovementInput
  ) => Promise<CustomerDetail>
  customersMovementRemove: (movementId: number) => Promise<CustomerDetail>
  salesComplete: (input: CompleteSalePayload) => Promise<SaleResult>
  holdsList: () => Promise<Hold[]>
  holdsCreate: (input: { customerName?: string; itemsJson: string; total: number }) => Promise<Hold>
  holdsRemove: (id: number) => Promise<void>
  holdsComplete: (id: number) => Promise<void>
  cashGetOpen: () => Promise<CashShiftSummary | null>
  cashOpen: (input: OpenShiftInput) => Promise<CashShiftSummary>
  cashClose: (shiftId: number, input: CloseShiftInput) => Promise<CashShiftSummary>
  cashList: () => Promise<CashShiftSummary[]>
  returnsSales: () => Promise<SaleSummary[]>
  returnsSaleReturnable: (saleId: number) => Promise<SaleForReturn>
  returnsComplete: (input: CompleteReturnPayload) => Promise<ReturnResult>
  returnsList: () => Promise<ReturnSummary[]>
  exchangesComplete: (input: CompleteExchangePayload) => Promise<ExchangeResult>
  exchangesList: () => Promise<ExchangeSummary[]>
  suppliersList: () => Promise<Supplier[]>
  suppliersWithBalance: () => Promise<SupplierWithBalance[]>
  suppliersCreate: (input: SupplierInput) => Promise<Supplier>
  suppliersUpdate: (id: number, input: SupplierInput) => Promise<Supplier>
  suppliersRemove: (id: number) => Promise<void>
  suppliersDetail: (id: number) => Promise<SupplierDetail>
  suppliersDebtAdd: (id: number, input: SupplierMovementInput) => Promise<SupplierDetail>
  suppliersPay: (id: number, input: SupplierPayInput) => Promise<SupplierDetail>
  suppliersMovementEdit: (movementId: number, input: SupplierMovementInput) => Promise<SupplierDetail>
  suppliersMovementRemove: (movementId: number) => Promise<SupplierDetail>
  purchasesComplete: (input: CompletePurchasePayload) => Promise<PurchaseResult>
  purchasesSupplierReturn: (input: CompletePurchasePayload) => Promise<PurchaseResult>
  purchasesList: (kind?: PurchaseKind) => Promise<PurchaseSummary[]>
  purchasesDetail: (id: number) => Promise<PurchaseDetail>
  purchasesUpdate: (id: number, input: CompletePurchasePayload) => Promise<PurchaseResult>
  purchasesRemove: (id: number) => Promise<void>
  authChangePassword: (current: string, next: string) => Promise<ChangePasswordResult>
  dashboardSummary: () => Promise<DashboardSummary>
  reportsPeriod: (from: number, to: number) => Promise<PeriodReport>
  backupsList: () => Promise<BackupInfo[]>
  backupCreate: () => Promise<BackupInfo>
  backupImport: (name: string, data: ArrayBuffer) => Promise<BackupInfo>
  backupRestore: (id: number) => Promise<void>
  updateCheck: () => Promise<{ ok: boolean; message: string }>
  onDataChanged: (cb: (version: number) => void) => () => void
}