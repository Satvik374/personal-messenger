import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createClient, type Client } from '@libsql/client'

export type DbValue = string | number | null

export interface RunResult {
  lastInsertRowid: number
  rowsAffected: number
}

/**
 * Minimal async database surface. Two implementations keep development free of
 * native modules (Node's built-in SQLite) while production uses Turso over HTTP.
 */
export interface DbClient {
  all<T = Record<string, unknown>>(sql: string, args?: DbValue[]): Promise<T[]>
  run(sql: string, args?: DbValue[]): Promise<RunResult>
  close(): void
}

function resolveLocalPath(url: string): string {
  if (url === ':memory:' || url === 'file::memory:') return ':memory:'
  const withoutScheme = url.startsWith('file:') ? url.slice('file:'.length) : url
  const cleaned = withoutScheme.replace(/^\/\//, '')
  if (cleaned === ':memory:') return ':memory:'
  return isAbsolute(cleaned) ? cleaned : resolve(process.cwd(), cleaned)
}

export function createLocalDb(url = 'file:./data/messenger.db'): DbClient {
  const path = resolveLocalPath(url)
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')

  return {
    async all<T>(sql: string, args: DbValue[] = []) {
      const statement = db.prepare(sql)
      return statement.all(...args) as T[]
    },
    async run(sql: string, args: DbValue[] = []) {
      const result = db.prepare(sql).run(...args)
      return {
        lastInsertRowid: Number(result.lastInsertRowid ?? 0),
        rowsAffected: Number(result.changes ?? 0),
      }
    },
    close() {
      db.close()
    },
  }
}

export function createTursoDb(url: string, authToken: string): DbClient {
  const client: Client = createClient({ url, authToken })
  return {
    async all<T>(sql: string, args: DbValue[] = []) {
      const result = await client.execute({ sql, args })
      return result.rows as unknown as T[]
    },
    async run(sql: string, args: DbValue[] = []) {
      const result = await client.execute({ sql, args })
      return {
        lastInsertRowid: Number(result.lastInsertRowid ?? 0),
        rowsAffected: Number(result.rowsAffected ?? 0),
      }
    },
    close() {
      client.close()
    },
  }
}

export function createDb(url: string, authToken: string): DbClient {
  const isRemote = url.startsWith('libsql://') || url.startsWith('http://') || url.startsWith('https://')
  if (isRemote) {
    if (!authToken) throw new Error('TURSO_AUTH_TOKEN is required for a remote database URL')
    return createTursoDb(url, authToken)
  }
  return createLocalDb(url || 'file:./data/messenger.db')
}
