/**
 * Veritabanı şeması.
 * KURAL: Tüm para alanları INTEGER (kuruş) cinsinden saklanır — float hatasını önler.
 * Tarihler: created_at/updated_at INTEGER (unix ms); kullanıcıya dönük günler TEXT 'YYYY-MM-DD'.
 * Stok miktarları REAL (kasada yarım birim olabilir).
 */
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','personel')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode        TEXT NOT NULL DEFAULT '',
  name           TEXT NOT NULL,
  category_id    INTEGER REFERENCES categories(id),
  purchase_price INTEGER NOT NULL DEFAULT 0,
  sale_price     INTEGER NOT NULL DEFAULT 0,
  stock_qty      REAL NOT NULL DEFAULT 0,
  min_stock      REAL NOT NULL DEFAULT 0,
  image          TEXT,
  note           TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_barcode  ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_name     ON products(name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_barcode_nonempty
  ON products(barcode) WHERE barcode IS NOT NULL AND barcode != '';

CREATE TABLE IF NOT EXISTS suppliers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT,
  address    TEXT,
  note       TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  phone           TEXT,
  note            TEXT,
  installment_day INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- Satış (fiş). status: completed | returned | partially_returned
CREATE TABLE IF NOT EXISTS sales (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no    TEXT NOT NULL UNIQUE,
  customer_id   INTEGER REFERENCES customers(id),
  subtotal      INTEGER NOT NULL DEFAULT 0,
  discount_total INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  paid_amount   INTEGER NOT NULL DEFAULT 0,
  debt_amount   INTEGER NOT NULL DEFAULT 0,
  is_credit     INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'completed',
  note          TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_date     ON sales(created_at);

CREATE TABLE IF NOT EXISTS sale_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id    INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  quantity   REAL NOT NULL,
  unit_price INTEGER NOT NULL,
  discount   INTEGER NOT NULL DEFAULT 0,
  line_total INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

-- Ödemeler (nakit/kart/havale). kind: sale = satış anında, debt = borç tahsilatı
CREATE TABLE IF NOT EXISTS sale_payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id        INTEGER REFERENCES sales(id),
  customer_id    INTEGER REFERENCES customers(id),
  date           TEXT NOT NULL,
  amount         INTEGER NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','card','transfer')),
  kind           TEXT NOT NULL DEFAULT 'sale',
  note           TEXT,
  is_manual      INTEGER NOT NULL DEFAULT 0,
  created_by     INTEGER REFERENCES users(id),
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_payments_customer ON sale_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_sale_payments_date     ON sale_payments(date);

-- Borç/veresiye hareketleri. amount: + borç arttırır, - borç azaltır.
-- source: sale | sale_return | exchange | refund | payment | manual_in | manual_out | opening
CREATE TABLE IF NOT EXISTS debt_movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id    INTEGER REFERENCES customers(id),
  supplier_id    INTEGER REFERENCES suppliers(id),
  sale_id        INTEGER REFERENCES sales(id),
  return_id      INTEGER REFERENCES returns(id),
  date           TEXT NOT NULL,
  amount         INTEGER NOT NULL,
  balance_after  INTEGER NOT NULL,
  source         TEXT NOT NULL,
  payment_method TEXT,
  note           TEXT,
  is_manual      INTEGER NOT NULL DEFAULT 0,
  created_by     INTEGER REFERENCES users(id),
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_debt_customer  ON debt_movements(customer_id);
CREATE INDEX IF NOT EXISTS idx_debt_supplier  ON debt_movements(supplier_id);
CREATE INDEX IF NOT EXISTS idx_debt_date      ON debt_movements(date);

-- Alış (tedarikçiden mal girişi → stok artar)
CREATE TABLE IF NOT EXISTS purchases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_no  TEXT NOT NULL UNIQUE,
  supplier_id  INTEGER REFERENCES suppliers(id),
  purchase_date TEXT NOT NULL,
  total        INTEGER NOT NULL DEFAULT 0,
  paid_amount  INTEGER NOT NULL DEFAULT 0,
  debt_amount  INTEGER NOT NULL DEFAULT 0,
  note         TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date     ON purchases(purchase_date);

CREATE TABLE IF NOT EXISTS purchase_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id  INTEGER REFERENCES products(id),
  quantity    REAL NOT NULL,
  unit_cost   INTEGER NOT NULL,
  line_total  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON purchase_items(product_id);

CREATE TABLE IF NOT EXISTS purchase_payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id    INTEGER REFERENCES purchases(id),
  supplier_id    INTEGER REFERENCES suppliers(id),
  date           TEXT NOT NULL,
  amount         INTEGER NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','card','transfer')),
  note           TEXT,
  is_manual      INTEGER NOT NULL DEFAULT 0,
  created_by     INTEGER REFERENCES users(id),
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_payments_supplier ON purchase_payments(supplier_id);

-- Yedekler (dosya + kayıt). kind: auto (günlük) | manual | import | safety (geri yükleme öncesi)
CREATE TABLE IF NOT EXISTS backups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  filename   TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('auto','manual','import','safety')),
  note       TEXT,
  size       INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at);

-- İade (satış iadesi). settlement: debt | cash_back | mixed
CREATE TABLE IF NOT EXISTS returns (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  return_no        TEXT NOT NULL UNIQUE,
  original_sale_id INTEGER REFERENCES sales(id),
  customer_id      INTEGER REFERENCES customers(id),
  total            INTEGER NOT NULL DEFAULT 0,
  settlement_method TEXT NOT NULL CHECK (settlement_method IN ('debt','cash_back','mixed')),
  note             TEXT,
  created_by       INTEGER REFERENCES users(id),
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_returns_sale ON returns(original_sale_id);

CREATE TABLE IF NOT EXISTS return_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id  INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  quantity   REAL NOT NULL,
  unit_price INTEGER NOT NULL,
  line_total INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS return_payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id      INTEGER NOT NULL REFERENCES returns(id),
  customer_id    INTEGER REFERENCES customers(id),
  date           TEXT NOT NULL,
  amount         INTEGER NOT NULL,
  payment_method TEXT CHECK (payment_method IN ('cash','card','transfer')),
  kind           TEXT NOT NULL CHECK (kind IN ('refund','debt_credit')),
  note           TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     INTEGER NOT NULL
);

-- Değişim (ürün takası). difference = total_out - total_in
CREATE TABLE IF NOT EXISTS exchanges (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange_no          TEXT NOT NULL UNIQUE,
  original_sale_id     INTEGER REFERENCES sales(id),
  customer_id          INTEGER REFERENCES customers(id),
  total_in             INTEGER NOT NULL DEFAULT 0,
  total_out            INTEGER NOT NULL DEFAULT 0,
  difference           INTEGER NOT NULL DEFAULT 0,
  difference_settlement TEXT NOT NULL DEFAULT 'none'
                       CHECK (difference_settlement IN ('none','cash','card','transfer','debt')),
  note                 TEXT,
  created_by           INTEGER REFERENCES users(id),
  created_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exchanges_original_sale ON exchanges(original_sale_id);

CREATE TABLE IF NOT EXISTS exchange_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange_id INTEGER NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
  product_id  INTEGER REFERENCES products(id),
  quantity    REAL NOT NULL,
  unit_price  INTEGER NOT NULL,
  direction   TEXT NOT NULL CHECK (direction IN ('in','out')),
  line_total  INTEGER NOT NULL
);

-- Müşteri beklet (sepetteki satışları tutar)
CREATE TABLE IF NOT EXISTS holds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hold_no       TEXT NOT NULL,
  customer_name TEXT,
  items_json    TEXT NOT NULL,
  total         INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active',
  created_by    INTEGER REFERENCES users(id),
  created_at    INTEGER NOT NULL
);

-- Kasa açılış/kapanış (gün sonu sayımı). Zamanlar INTEGER (ms) — aralık sorguları için.
CREATE TABLE IF NOT EXISTS cash_shifts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  opened_at        INTEGER NOT NULL,
  opening_balance  INTEGER NOT NULL DEFAULT 0,
  opened_by        INTEGER REFERENCES users(id),
  closed_at        INTEGER,
  closing_balance  INTEGER,
  expected_balance INTEGER,
  note             TEXT,
  status           TEXT NOT NULL DEFAULT 'open'
);

-- Uygulama ayarları (anahtar-değer)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`