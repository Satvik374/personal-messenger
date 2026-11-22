import type { DbClient } from './client.js'

/**
 * Append-only migration list. Each entry is one version made of single
 * statements, because Turso's HTTP client executes one statement per call.
 * Never edit a shipped entry; append a new one instead.
 */
export const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name  TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      accent        TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      last_seen_at  INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  TEXT NOT NULL,
      platform    TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      revoked_at  INTEGER,
      replaced_by TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(token_hash)`,
    `CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT PRIMARY KEY,
      kind       TEXT NOT NULL CHECK (kind IN ('dm','group')),
      title      TEXT,
      dm_key     TEXT UNIQUE,
      created_by TEXT REFERENCES users(id),
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS members (
      conversation_id      TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at            INTEGER NOT NULL,
      last_read_message_id INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (conversation_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id)`,
    `CREATE TABLE IF NOT EXISTS messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id       TEXT NOT NULL REFERENCES users(id),
      body            TEXT NOT NULL,
      client_id       TEXT NOT NULL,
      created_at      INTEGER NOT NULL,
      deleted_at      INTEGER
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client ON messages(sender_id, client_id)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id)`,
    `CREATE TABLE IF NOT EXISTS devices (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform     TEXT NOT NULL CHECK (platform IN ('android','desktop')),
      fcm_token    TEXT,
      created_at   INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_token ON devices(fcm_token) WHERE fcm_token IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS invites (
      code       TEXT PRIMARY KEY,
      created_by TEXT REFERENCES users(id),
      expires_at INTEGER,
      used_by    TEXT REFERENCES users(id),
      created_at INTEGER NOT NULL
    )`,
  ],
]

export async function migrate(db: DbClient): Promise<number> {
  await db.run('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const rows = await db.all<{ version: number }>('SELECT version FROM schema_version LIMIT 1')
  const current = Number(rows[0]?.version ?? 0)

  for (let version = current; version < MIGRATIONS.length; version += 1) {
    for (const statement of MIGRATIONS[version] ?? []) {
      await db.run(statement)
    }
  }

  const target = MIGRATIONS.length
  if (rows.length === 0) {
    await db.run('INSERT INTO schema_version (version) VALUES (?)', [target])
  } else if (current !== target) {
    await db.run('UPDATE schema_version SET version = ?', [target])
  }
  return target
}
