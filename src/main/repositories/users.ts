import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { getDb } from '../database'
import type { User, Role } from '@shared/types'

interface UserRow {
  id: number
  username: string
  password_hash: string
  name: string
  role: Role
  is_active: number
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    isActive: row.is_active === 1
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

/**
 * İlk kurulumda kullanıcı yoksa demo hesapları oluştur:
 * - admin / admin    (tam yetki)
 * - personel / personel (sadece satış + borçları görür)
 * Kullanıcı ilk girişte şifre değiştirmesi konusunda uyarılacak.
 */
export function seedDefaultAdmin(): void {
  const db = getDb()
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }
  if (count.c === 0) {
    const insert = db.prepare(
      `INSERT INTO users (username, password_hash, name, role, is_active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
    insert.run('admin', hashPassword('admin'), 'Yönetici', 'admin', Date.now())
    insert.run('personel', hashPassword('personel'), 'Kasa Personeli', 'personel', Date.now())
    console.warn('[seed] Demo hesaplar oluşturuldu: admin/admin ve personel/personel (ilk girişte değiştirin!)')
  }
}

export function verifyCredentials(username: string, password: string): User | null {
  const row = getDb()
    .prepare('SELECT * FROM users WHERE username = ? AND is_active = 1')
    .get(username) as UserRow | undefined
  if (!row) return null
  if (!verifyPassword(password, row.password_hash)) return null
  return rowToUser(row)
}

export function createUser(
  username: string,
  password: string,
  name: string,
  role: Role
): User {
  const db = getDb()
  const result = db
    .prepare(
      `INSERT INTO users (username, password_hash, name, role, is_active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
    .run(username, hashPassword(password), name, role, Date.now())
  const row = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(result.lastInsertRowid) as UserRow
  return rowToUser(row)
}

export function listUsers(): User[] {
  const rows = getDb()
    .prepare('SELECT * FROM users ORDER BY role, name')
    .all() as UserRow[]
  return rows.map(rowToUser)
}

export function getPasswordHash(userId: number): string | null {
  const row = getDb()
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .get(userId) as { password_hash: string } | undefined
  return row?.password_hash ?? null
}

export function updatePassword(userId: number, password: string): void {
  getDb()
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(hashPassword(password), userId)
}